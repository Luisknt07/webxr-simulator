'use strict';
// A test operator sends the same bounded steering, pedal, hydraulic and G/K
// commands as a learner. No object transform, pose or custody field is written.
module.exports=function manualDriver(h,f,record){
 const THREE=h.THREE,api=f.runtime.vehicleRuntime,v=record.components.vehicle,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
 const yaw=()=>{const forward=new THREE.Vector3(0,0,1).applyQuaternion(record.object.quaternion);return Math.atan2(forward.x,forward.z);};
 let ticks=0,contacts=0;
 const tick=input=>{api.setInput(record,input);h.advance(f,1/60);ticks++;if(v.blocked)contacts++;if(v.training&&v.training.error)throw Error(v.training.error);};
 const stop=(steer=0)=>{for(let n=0;n<90;n++)tick({brake:1,steer});if(Math.abs(v.actualSpeed)>.003)throw Error('Test operator could not stop.');};
 const straight=(axis,target,reverse=false)=>{
  stop();const other=axis==='x'?'z':'x',cross=record.object.position[other],sign=Math.sign(target-record.object.position[axis]),direction=reverse?-1:1,heading=Math.atan2(axis==='x'?sign*direction:0,axis==='z'?sign*direction:0);
  for(let n=0;n<18000;n++){
   const remaining=sign*(target-record.object.position[axis]);if(remaining<.025){stop();return;}
   const error=wrap(heading-yaw()),steer=-direction*error*8;
   tick({throttle:direction*Math.min(.75,Math.max(.16,remaining*1.2)),steer:Math.max(-.3,Math.min(.3,steer))});
   if(v.blocked)throw Error('Physical contact while driving '+axis+' towards '+target+' at '+record.object.position.toArray());
   if(Math.abs(record.object.position[other]-cross)>.15)throw Error('Test operator drifted from a straight corridor.');
  }throw Error('Timed out driving a straight corridor.');
 };
 const turn=(yawDirection,reverse=false)=>{
  stop();const direction=reverse?-1:1,steer=-yawDirection*direction*.8;
  for(let n=0;n<120;n++)tick({brake:1,steer});
  const radius=v.config.wheelbase/Math.tan(Math.abs(v.steering)),target=wrap(yaw()+yawDirection*Math.PI/2);
  for(let n=0;n<6000;n++){
   const remaining=yawDirection*wrap(target-yaw());if(remaining<.006){stop(steer);stop();return radius;}
   tick({throttle:direction*.35,steer});if(v.blocked)throw Error('Physical contact in a quarter turn at '+record.object.position.toArray());
  }throw Error('Timed out in a quarter turn.');
 };
 const lift=height=>{stop();for(let n=0;n<3000;n++){const input={brake:1};if(api.heightInput(record,input,height)){stop();return;}tick(input);if(v.blocked)throw Error('Physical contact while adjusting fork height.');}throw Error('Timed out adjusting fork height.');};
 const dock=(kind,targetId,approach)=>{
  stop();v.route=[{position:new THREE.Vector3(approach.x,0,approach.z),action:kind,targetId,yaw:Math.PI,speed:.35}];v.routeIndex=0;v.missionStage='prepare';v.missionDock=null;v.missionCandidate=null;v.missionDelivery=null;v.missionElapsed=0;
  for(let n=0;n<18000;n++){
   const destination=kind==='drop'&&(v.missionDelivery||f.runtime.vehicleTraining.destination(record));
   if(process.env.PRACTICE_DRIVER_DEBUG&&n%600===0)console.log('dock',kind,n/60,record.object.position.toArray(),v.missionStage,v.missionStatus,v.pose.lift,api.releasePlan(record,destination).reason,v.missionDock&&{position:v.missionDock.position.toArray(),yaw:v.missionDock.yaw},destination&&new THREE.Vector3().setFromMatrixPosition(destination.matrix).toArray());
   const ready=kind==='pickup'?api.pickupPlan(record).ready:api.releasePlan(record,destination).ready;
   if(v.missionStage==='dock'&&ready){stop();const accepted=kind==='pickup'?api.pickup(record):api.release(record,destination);if(!accepted)throw Error('Native '+kind+' refused after its own plan was ready: '+v.warning);return;}
   let input=api.automatic(record,1/60);if(input.throttle)input.throttle*=.15;
   if(kind==='drop'&&v.missionStage==='dock'&&v.missionDock){const goal=v.missionDock;if(Math.abs(record.object.position.x-goal.position.x)>.12)throw Error('The test operator did not align the drop approach.');if(record.object.position.z<goal.position.z-.08)throw Error('The test operator overshot the drop support: '+api.releasePlan(record,destination).reason);input={throttle:.08,steer:Math.max(-.2,Math.min(.2,-wrap(goal.yaw-yaw())*8))};}
   tick(input);
   if(kind==='pickup'?!!v.entry:!v.entry){stop();return;}
   if(v.blocked){const plan=kind==='pickup'?api.pickupPlan(record):api.releasePlan(record);if(!plan.ready)throw Error('Physical contact while docking: '+plan.reason);}
  }throw Error('Timed out native '+kind+' docking: '+v.missionStatus+' / '+v.warning);
 };
 return {tick,stop,straight,turn,lift,dock,yaw,stats:()=>({ticks,contacts,distance:v.distance})};
};
