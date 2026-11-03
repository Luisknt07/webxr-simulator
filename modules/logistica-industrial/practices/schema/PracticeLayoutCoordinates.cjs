'use strict';
// Editor and XR selectors write native world coordinates, never document-table
// coordinates. Keep the active montage's explicit engineering adjustments when
// editing one axis; before mounting, use the centred source layout bindings.
function pose(plan,row,manifest){
 const binding=(plan.layoutBindings||[]).find(value=>value.alias===(row.alias||row.id));
 const same=manifest&&manifest.practiceId===plan.id&&(manifest.mode||manifest.settings&&manifest.settings.mode||manifest.plan&&manifest.plan.mode)===plan.mode;
 const actual=same&&(manifest.aliases||[]).find(value=>value.alias===(row.alias||row.id));
 const position=actual&&actual.actualPose&&actual.actualPose.position;
 if(Array.isArray(position)&&position.length===3&&position.every(Number.isFinite)){
  const rotation=actual.actualPose.rotation||[];
  return{x:position[0],z:position[2],yaw:Number.isFinite(rotation[1])?Math.round(rotation[1]*180/Math.PI*100)/100:0};
 }
 const center=binding&&binding.sourceCenter;
 if(Array.isArray(center)&&center.length===3&&center.every(Number.isFinite))return{x:center[0],z:center[2],yaw:0};
 const input=row.center||row.position||row.pose||[],area=plan.interiorArea||{};
 if(Array.isArray(input)&&input.length>=2)return{x:Number(input[0]||0)-Number(area.width||0)/2,z:Number(input[1]||0)-Number(area.depth||0)/2,yaw:0};
 return{x:0,z:0,yaw:0};
}
module.exports={pose};
