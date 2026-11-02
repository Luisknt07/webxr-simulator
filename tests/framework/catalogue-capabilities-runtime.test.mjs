import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),h=require('../legacy/test-processor-runtime.js'),native=require('../legacy/test-vehicle-storage.js');
const robots=require('../../modules/logistica-industrial/functions/robots/schema/robots.js'),caps=require('../../modules/logistica-industrial/functions/equipamiento/schema/equipmentCapabilities.cjs');
function setup(){const f=h.setup();f.document=new native.Document({});f.document.registerRoom('hall',f.root);f.ctx.collisionWorld=new f.ctx.collisionWorld.constructor(f.ctx,f.document);f.runtime=new f.runtime.constructor(f.ctx,f.document);return f;}
function sensor(f,id,target){const actor=f.document.addPrefab('hall','sensor','catalogue:'+id);f.document.setBehaviors(actor,f.document.getBehaviors(actor).map(row=>row.type==='sensor'?Object.assign({},row,{sourceId:target.userData.editorId}):row));f.document.setTransform(actor,{position:[5,1,0]});return actor;}

test('native robot normalization and pick admission enforce the actual catalogue tool without stealing a load',()=>{
 const config=robots.normalize(Object.assign({},robots.defaults('articulated-general'),{catalogueToolId:'equipment.tool.magnet',tool:'gripper'}));assert.equal(config.catalogueToolId,'equipment.tool.magnet');
 assert.throws(()=>robots.normalize(Object.assign({},config,{tool:'vacuum'})),/acoplamiento/);
 assert.throws(()=>robots.normalize(Object.assign({},robots.defaults('agv'),{catalogueToolId:'equipment.tool.forks',tool:'fork'})),/muñeca/);
 assert.equal(robots.productCompatibility(config,{productType:'cylinder',width:.2,height:.2,depth:.2,mass:2,materialClass:'steel'}).accepted,true);
 assert.equal(robots.productCompatibility(config,{productType:'cylinder',width:.2,height:.2,depth:.2,mass:2,materialClass:'non-ferrous'}).accepted,false);
 const RobotRuntime=require('../support/load-robot-runtime.js')(h.THREE),events=[],product={object:new h.THREE.Group(),robotReservedBy:'robot-live',sourceEntry:{id:'same-load',ownerId:'source-live',units:1}},runtime={productMetadata:()=>({productType:'cylinder',width:.2,height:.2,depth:.2,mass:2,materialClass:'non-ferrous'}),event:(...row)=>events.push(row)},api=new RobotRuntime(runtime),record={id:'robot-live',components:{robot:{config,candidate:{product},running:true}}};
 assert.equal(api.pick(record),false);assert.equal(product.sourceEntry.id,'same-load');assert.equal(product.sourceEntry.ownerId,'source-live');assert.equal(product.robotOwnerId,undefined);assert.equal(product.robotReservedBy,undefined);assert.match(record.components.robot.fault,/ferromagnético/);assert.equal(events.length,1);
});

test('catalogue sensors read live native encoder motion and identity; absent temperature remains unknown',()=>{
 const f=setup(),belt=h.add(f,'conveyor',{length:2,speed:1.5,autoSpawn:false,powered:true,running:true,withSensors:false,withPanel:false},[0,1,0]),source=h.add(f,'source',{initialCount:1,autoGenerate:false,delivery:'manual'},[-8,1,0]);
 const encoder=sensor(f,'equipment.sensor.encoder-limit',belt),reader=sensor(f,'equipment.sensor.barcode-rf',source),condition=sensor(f,'equipment.sensor.condition',source);
 f.runtime.start('hall');h.advance(f,.5);
 const e=h.record(f,encoder),r=h.record(f,reader),c=h.record(f,condition);assert.equal(e.variables.measurementKnown,true);assert.equal(e.variables.measurementUnit,'m');assert.ok(e.variables.measurementValue>.5);assert.equal(r.variables.measurementKnown,true);assert.equal(r.variables.measurementValue,'product');assert.equal(c.variables.measurementKnown,false);assert.equal(c.variables.measurementValue,null);
 f.runtime.command(belt.userData.editorId,'stop');const position=e.variables.measurementValue;h.advance(f,.5);assert.equal(e.variables.measurementValue,position);f.runtime.stop();
});

test('service controls invoke bounded native commands only in a permitted context and preserve emergency latching',()=>{
 const f=setup(),belt=h.add(f,'conveyor',{autoSpawn:false,powered:true,running:true,withPanel:false},[0,1,0]);f.runtime.start('hall');const id=belt.userData.editorId,component=h.record(f,belt).components.conveyor;
 assert.throws(()=>caps.serviceCommand('equipment.utility.motor-drive',{targetId:id,action:'stop'},{runtime:f.runtime,canControl:()=>false}),/unavailable/);assert.equal(component.running,true);
 assert.equal(caps.serviceCommand('equipment.utility.motor-drive',{targetId:id,action:'emergency'},{runtime:f.runtime,canControl:()=>true}),true);assert.equal(component.emergency,true);assert.equal(component.running,false);
 caps.serviceCommand('equipment.utility.motor-drive',{targetId:id,action:'resetEmergency'},{runtime:f.runtime,canControl:()=>true});assert.equal(component.emergency,false);assert.equal(component.running,false);
 assert.throws(()=>caps.serviceCommand('equipment.utility.motor-drive',{targetId:id,action:'eval'},{runtime:f.runtime,canControl:()=>true}),/Unsupported/);f.runtime.stop();
});
