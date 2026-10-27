'use strict';
const ACTIONS=['drive','approach','pickup','drop','wait'];
function plain(value){return value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function parse(value={}){let points=value.waypointsJson||'[]';if(typeof points==='string'){if(points.length>12000)throw new Error('Ruta de vehículo demasiado grande.');try{points=JSON.parse(points);}catch(_){throw new Error('Ruta de vehículo JSON inválida.');}}
  if(!Array.isArray(points)||points.length>48)throw new Error('La ruta admite hasta 48 puntos.');return points.map(point=>{if(!plain(point)||Object.keys(point).some(key=>!['x','z','speed','action','yaw','lift','hold','reverse','targetId'].includes(key)))throw new Error('Punto de ruta inválido.');
    ['x','z'].forEach(key=>{if(!Number.isFinite(point[key])||Math.abs(point[key])>250)throw new Error('Coordenadas de ruta fuera de rango.');});
    const limits={speed:[.05,5],yaw:[-Math.PI*2,Math.PI*2],lift:[0,12],hold:[0,3600]};Object.keys(limits).forEach(key=>{if(point[key]!==undefined&&(!Number.isFinite(point[key])||point[key]<limits[key][0]||point[key]>limits[key][1]))throw new Error('Valor de ruta inválido: '+key);});
    if(point.action!==undefined&&!ACTIONS.includes(point.action))throw new Error('Acción de ruta inválida.');if(point.reverse!==undefined&&typeof point.reverse!=='boolean')throw new Error('Sentido de ruta inválido.');if(point.targetId!==undefined&&(typeof point.targetId!=='string'||point.targetId.length>128||/[\x00-\x20\x7f<>"'\\]/.test(point.targetId)))throw new Error('Destino de ruta inválido.');return Object.assign({},point);});
}
function wrap(angle){return Math.atan2(Math.sin(angle),Math.cos(angle));}
/** Bicycle controller for authored aisle corridors, never obstacle-avoiding SLAM. */
function drive(state,goal){const dx=goal.x-state.x,dz=goal.z-state.z,distance=Math.hypot(dx,dz),reverse=goal.reverse===true,direction=reverse?-1:1,heading=state.yaw+(reverse?Math.PI:0),angle=wrap(Math.atan2(dx,dz)-heading),tolerance=goal.tolerance||.035;
  if(distance<=tolerance)return {throttle:0,steer:0,brake:1,arrived:Math.abs(state.speed)<.025,distance,misaligned:goal.yaw!==undefined&&Math.abs(wrap(goal.yaw-state.yaw))>.10};
  const max=Math.min(state.limit,goal.speed||state.limit),stopping=Math.sqrt(2*Math.max(.2,state.deceleration*.6)*Math.max(0,distance-tolerance*.5));const velocity=Math.min(max,stopping,Math.max(.05,max*(1-Math.min(1,Math.abs(angle))*.65)));
  const pursuitAngle=Math.max(-1.4,Math.min(1.4,angle)),steering=Math.atan2(2*(state.wheelbase||1)*Math.sin(pursuitAngle),Math.max(.15,distance))/(state.steerLimit||1);
  return {throttle:direction*velocity/Math.max(.1,state.limit),steer:Math.max(-1,Math.min(1,direction*steering)),brake:0,arrived:false,distance,misaligned:false};
}
module.exports={ACTIONS,parse,drive,wrap};
