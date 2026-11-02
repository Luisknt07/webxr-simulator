'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const robots=require('../../modules/logistica-industrial/functions/robots/schema/robots.js');
const kin=require('../../modules/logistica-industrial/functions/robots/schema/robot-kinematics.js');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The fixed digest fixture was captured from the shipped, uncached solver.
// It covers every native architecture, whole FK results and seeded IK results,
// including clamping/limits and unreachable targets, without a second solver.
function corpus(variant){
 const config=robots.normalize({variant}),definitions=robots.getJointDefinitions(config),rows=[];
 rows.push({kind:'home',result:kin.homePose(config)});
 for(let sample=0;sample<12;sample++){
  const joints=definitions.map((joint,index)=>joint.min+(joint.max-joint.min)*(.05+.90*((sample*7+index*3)%13)/12));
  const pose=kin.forward(config,joints),target={position:pose.toolPosition,quaternion:pose.quaternion};
  rows.push({kind:'sample',joints,forward:pose,inverse:kin.inverse(config,target,joints)});
 }
 rows.push({kind:'clamped',result:kin.forward(config,definitions.map((joint,index)=>index%2?joint.max+4:joint.min-4))});
 rows.push({kind:'unreachable',result:kin.inverse(config,[config.reach*10,config.height*10,config.reach*10])});
 return rows;
}
function run(){
 const golden=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/robot-kinematics-before-cache.json'),'utf8'));
 assert.equal(golden.format,'smarttwin.kinematics-pre-cache');
 for(const variant of robots.VARIANTS)assert.equal(digest(corpus(variant.id)),golden.variants[variant.id],'All FK/IK bytes must remain unchanged: '+variant.id);

 const cartesian=robots.normalize({variant:'cartesian',length:3,width:2,height:2});
 const oldLimits=kin.jointDefinitions(cartesian);assert.equal(oldLimits[0].max,1.5);
 Object.assign(cartesian,{length:4,width:3,height:3});
 const cartesianLimits=kin.jointDefinitions(cartesian);
 assert.deepEqual(cartesianLimits.map(j=>[j.min,j.max,j.home]),[[-2,2,0],[-1.5,1.5,0],[0,3,1.5]]);
 assert.deepEqual(kin.forward(cartesian,[20,-20,20]).joints,[2,-1.5,3]);assert.equal(oldLimits[0].max,1.5);
 const cylinder=robots.normalize({variant:'cylindrical-rpp',height:1,reach:2});kin.homePose(cylinder);
 Object.assign(cylinder,{height:2,reach:3});assert.deepEqual(kin.jointDefinitions(cylinder).slice(1).map(j=>j.max),[2,3]);
 const sorter=robots.normalize({variant:'mobile-sorter-crossbelt',length:1,maxProductDepth:.8});kin.homePose(sorter);
 Object.assign(sorter,{length:2,maxProductDepth:1.4});assert.equal(kin.jointDefinitions(sorter)[0].max,3.4);
 for(const tool of ['fork','platform']){
  const support=robots.normalize({variant:'articulated-general',tool,maxProductWidth:.05,maxProductDepth:.8}),first=kin.getDimensions(support);
  assert.equal(first.toolSupport.width,.4);
  for(const [width,expected] of [[1,1],[4,1.4],[.05,.4]]){support.maxProductWidth=width;const current=kin.getDimensions(support);assert.equal(current.toolSupport.width,expected,'Live support width: '+tool);assert.equal(current.toolSupport.depth,.8);assert.deepEqual(current.toolOffset,first.toolOffset,'Width edits cannot change the physical TCP offset.');}
  support.maxProductDepth=1.2;assert.equal(kin.getDimensions(support).toolSupport.depth,1.2);assert.deepEqual(kin.getDimensions(support).toolOffset,[.2,.72,0]);assert.equal(first.toolSupport.width,.4);
 }
 const grip=robots.normalize({variant:'articulated-general',tool:'gripper',maxProductWidth:.3,maxProductDepth:.3,maxProductHeight:.3}),grasp={...kin.homePose(grip),gripSpan:.7};
 assert.throws(()=>kin.validatePose(grip,grasp),/apertura/);grip.maxProductHeight=.7;assert.equal(kin.validatePose(grip,grasp).gripSpan,.7,'A height edit must refresh the configured grip span allowance.');grip.maxProductHeight=.1;assert.throws(()=>kin.validatePose(grip,grasp),/apertura/);
 const architecture=robots.normalize({variant:'articulated-general'});assert.equal(kin.jointDefinitions(architecture).length,6);
 Object.assign(architecture,{variant:'scara',family:'scara'});assert.equal(kin.jointDefinitions(architecture).length,4);assert.equal(kin.jointDefinitions(architecture)[2].kind,'prismatic');

 const arm=robots.normalize({variant:'articulated-general'});kin.homePose(arm);
 arm.jointLimitsJson=JSON.stringify([{id:'J2',min:-.7,max:1.8,home:.4}]);
 assert.deepEqual(kin.jointDefinitions(arm),robots.getJointDefinitions(arm));assert.equal(kin.homePose(arm).joints[1],.4);
 const exposed=kin.jointDefinitions(arm);exposed[0].min=-999;exposed[0].id='poisoned';exposed.splice(1);
 assert.equal(kin.jointDefinitions(arm)[0].id,'J1');assert.equal(kin.jointDefinitions(arm).length,6);assert.equal(kin.clampJoints(arm,[-999])[0],-Math.PI);
 const schemaExposed=robots.getJointDefinitions(arm);schemaExposed[1].home=100;assert.equal(robots.getJointDefinitions(arm)[1].home,.4);
 const separate=robots.normalize({variant:'cartesian',height:1});assert.equal(kin.jointDefinitions(separate)[2].max,1);assert.equal(kin.jointDefinitions(cartesian)[2].max,3);
 const valid=kin.homePose(arm);assert.deepEqual(kin.validatePose(arm,valid),valid);
 assert.throws(()=>kin.validatePose(arm,{...valid,joints:valid.joints.map((a,i)=>i===1?2:a)}),/recorridos/);

 for(const row of golden.invalid){
  const value=robots.normalize({variant:'articulated-general'});kin.homePose(value);Object.assign(value,row.changes);
  for(const fn of [()=>kin.jointDefinitions(value),()=>kin.forward(value,[]),()=>kin.homePose(value)])assert.throws(fn,error=>error.message===row.error,'Warm configuration must not bypass prior validation: '+JSON.stringify(row.changes));
  value.jointLimitsJson='[]';value.reach=2.2;assert.equal(kin.jointDefinitions(value).length,6,'A rejected edit must not poison the last valid cache.');
 }

 // Deterministic work-count regression: validation remains at cache creation;
 // the subsequent fixed-step solves must not rebuild schema defaults/JSON.
 const original=robots.getJointDefinitions;let builds=0;
 robots.getJointDefinitions=function(value){builds++;return original(value);};
 try{
  const stable=robots.normalize({variant:'articulated-general',reach:2.25}),pose=kin.homePose(stable),target={position:pose.toolPosition,quaternion:pose.quaternion};
  const first=builds,expected=kin.inverse(stable,target,pose.joints).joints;assert.equal(first,1);
  for(let i=0;i<800;i++)assert.deepEqual(kin.inverse(stable,target,pose.joints).joints,expected);
  assert.equal(builds,first,'Stable solves must reuse one private mechanical table.');
  stable.jointLimitsJson=JSON.stringify([{id:'J1',min:-1,max:1,home:0}]);kin.homePose(stable);assert.equal(builds,first+1,'A changed limit table must be rebuilt and validated.');
 }finally{robots.getJointDefinitions=original;}
 console.log('Robot kinematics cache: all 15 native architectures byte-exact FK/IK, live mechanical edits/limits, independent callers, unchanged validation and 800 stable solves without table rebuilding passed.');
}
module.exports={corpus,digest};if(require.main===module)run();
