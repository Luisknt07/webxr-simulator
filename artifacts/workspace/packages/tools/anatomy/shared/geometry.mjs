import {normalizeModel,MODEL_LIMITS} from './model.mjs';
// All vertices are LOCAL Y-up metres. Box/roundedBox, cylinder/cone, sphere
// and torus are centred on the origin. A lathe follows its explicit Y heights;
// extrusion rises from Y=0 to height over an XZ profile; tubes follow their
// explicit local XYZ path. Position, Euler XYZ rotation and exploded offsets
// remain authoring metadata, applied once by the host. No DOM/Three/kernel or
// upstream SVG renderer is required to reconstruct a published triangle mesh.
const TAU=Math.PI*2,EPS=1e-12;
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,n)=>a.map(v=>v*n),dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const length=Math.hypot(...a);if(length<1e-10)throw Error('Anatomy: a path has a zero tangent or reverses direction.');return mul(a,1/length);};
function builder(){
 const positions=[];
 const triangle=(a,b,c,normal)=>{const n=cross(sub(b,a),sub(c,a));if(Math.hypot(...n)<EPS)return;if(normal&&dot(n,normal)<0)[b,c]=[c,b];for(const p of [a,b,c])for(const v of p){if(!Number.isFinite(v)||Math.abs(v)>100)throw Error('Anatomy: geometry exceeds the finite 100 m space.');positions.push(Object.is(v,-0)?0:v);}if(positions.length>MODEL_LIMITS.triangles*9)throw Error('Anatomy: triangle budget exceeded.');};
 const quad=(a,b,c,d,normal)=>{triangle(a,b,c,normal);triangle(a,c,d,normal);};
 return {positions,triangle,quad};
}
function box(a,b){
 const half=[a.width/2,a.height/2,a.depth/2],round=a.radius||0;
 const levels=half.map(h=>{if(!round)return [-h,h];const inner=h-round,q=Math.max(1,Math.floor(a.segments/8)),values=[];for(let i=0;i<=q;i++)values.push(-h+round*i/q);if(inner>EPS)values.push(inner);for(let i=1;i<=q;i++)values.push(inner+round*i/q);return values.filter((v,i)=>!i||Math.abs(v-values[i-1])>EPS);});
 const mapped=p=>{if(!round)return p;const c=p.map((v,i)=>Math.max(-half[i]+round,Math.min(half[i]-round,v))),delta=sub(p,c);return add(c,mul(unit(delta),round));};
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const u=(axis+1)%3,v=(axis+2)%3,normal=[0,0,0];normal[axis]=sign;const point=(x,y)=>{const p=[0,0,0];p[axis]=half[axis]*sign;p[u]=x;p[v]=y;return mapped(p);};for(let i=0;i<levels[u].length-1;i++)for(let j=0;j<levels[v].length-1;j++)b.quad(point(levels[u][i],levels[v][j]),point(levels[u][i+1],levels[v][j]),point(levels[u][i+1],levels[v][j+1]),point(levels[u][i],levels[v][j+1]),normal);}
}
function lathe(profile,n,b){
 const point=(row,j)=>[row[0]*Math.cos(j*TAU/n),row[1],row[0]*Math.sin(j*TAU/n)];
 for(let i=0;i<profile.length-1;i++)for(let j=0;j<n;j++){
  const next=(j+1)%n,p=point(profile[i],j),q=point(profile[i],next),r=point(profile[i+1],next),s=point(profile[i+1],j),theta=(j+.5)*TAU/n,normal=[Math.cos(theta),-(profile[i+1][0]-profile[i][0])/(profile[i+1][1]-profile[i][1]),Math.sin(theta)];
  b.quad(p,q,r,s,normal);
 }
 for(const [row,sign] of [[profile[0],-1],[profile[profile.length-1],1]])if(row[0]>0)for(let j=0;j<n;j++)b.triangle([0,row[1],0],point(row,j),point(row,(j+1)%n),[0,sign,0]);
}
function sphere(a,b){
 const n=a.segments,rows=Math.max(4,Math.floor(n/2)),profile=[];for(let i=0;i<=rows;i++){const angle=i*Math.PI/rows;profile.push([i===0||i===rows?0:a.radius*Math.sin(angle),-a.radius*Math.cos(angle)]);}lathe(profile,n,b);
}
function torus(a,b){
 const point=(i,j)=>{const angle=i*TAU/a.segments,t=j*TAU/a.tubeSegments,r=a.radius+a.tubeRadius*Math.cos(t);return [r*Math.cos(angle),a.tubeRadius*Math.sin(t),r*Math.sin(angle)];};
 for(let i=0;i<a.segments;i++)for(let j=0;j<a.tubeSegments;j++){const ni=(i+1)%a.segments,nj=(j+1)%a.tubeSegments,angle=(i+.5)*TAU/a.segments,t=(j+.5)*TAU/a.tubeSegments,normal=[Math.cos(angle)*Math.cos(t),Math.sin(t),Math.sin(angle)*Math.cos(t)];b.quad(point(i,j),point(ni,j),point(ni,nj),point(i,nj),normal);}
}
const orient2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area2=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-a[1]*b[0];},0);
function polygon(points){
 const p=points.map(row=>row.slice());if(p.length>3&&Math.hypot(...sub(p[0],p[p.length-1]))<1e-10)p.pop();
 const on=(a,b,c)=>Math.abs(orient2(a,b,c))<EPS&&c[0]>=Math.min(a[0],b[0])-EPS&&c[0]<=Math.max(a[0],b[0])+EPS&&c[1]>=Math.min(a[1],b[1])-EPS&&c[1]<=Math.max(a[1],b[1])+EPS;
 for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];if(Math.hypot(...sub(a,b))<1e-8)throw Error('Anatomy: profile repeats a vertex.');for(let j=i+2;j<p.length;j++){if(i===0&&j===p.length-1)continue;const c=p[j],d=p[(j+1)%p.length];if(orient2(a,b,c)*orient2(a,b,d)<0&&orient2(c,d,a)*orient2(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw Error('Anatomy: profile crosses or touches itself.');}}
 if(Math.abs(area2(p))<1e-10)throw Error('Anatomy: profile has no area.');if(area2(p)<0)p.reverse();
 // Remove collinear intermediate vertices before ear clipping, including caps.
 let changed=true;while(changed&&p.length>3){changed=false;for(let i=0;i<p.length;i++)if(Math.abs(orient2(p[(i+p.length-1)%p.length],p[i],p[(i+1)%p.length]))<EPS){p.splice(i,1);changed=true;break;}}
 const remaining=p.map((_,i)=>i),faces=[];let tries=0;
 while(remaining.length>3){let found=false;for(let k=0;k<remaining.length;k++){const ia=remaining[(k+remaining.length-1)%remaining.length],ib=remaining[k],ic=remaining[(k+1)%remaining.length],a=p[ia],b=p[ib],c=p[ic];if(orient2(a,b,c)<=EPS)continue;const inside=remaining.some(i=>i!==ia&&i!==ib&&i!==ic&&orient2(a,b,p[i])>=-EPS&&orient2(b,c,p[i])>=-EPS&&orient2(c,a,p[i])>=-EPS);if(inside)continue;faces.push([ia,ib,ic]);remaining.splice(k,1);found=true;break;}if(!found||++tries>64)throw Error('Anatomy: profile cannot be triangulated safely.');}
 faces.push(remaining.slice());return {points:p,faces};
}
function extrude(a,b){
 const p=polygon(a.profile),point=(i,y)=>[p.points[i][0],y,p.points[i][1]];
 for(const face of p.faces){b.triangle(...face.map(i=>point(i,0)),[0,-1,0]);b.triangle(...face.map(i=>point(i,a.height)),[0,1,0]);}
 for(let i=0;i<p.points.length;i++){const j=(i+1)%p.points.length,u=p.points[i],v=p.points[j],normal=[v[1]-u[1],0,u[0]-v[0]];b.quad(point(i,0),point(j,0),point(j,a.height),point(i,a.height),normal);}
}
function tube(a,b){
 const path=a.path,n=a.segments,frames=[];let previousT,previousU;
 for(let i=0;i<path.length;i++){
  const tangent=unit(i===0?sub(path[1],path[0]):i===path.length-1?sub(path[i],path[i-1]):add(unit(sub(path[i],path[i-1])),unit(sub(path[i+1],path[i]))));let u;
  if(!previousT){const reference=Math.abs(tangent[0])<.8?[1,0,0]:[0,1,0];u=unit(sub(reference,mul(tangent,dot(reference,tangent))));}
  else{const axis=cross(previousT,tangent),length=Math.hypot(...axis),cos=dot(previousT,tangent);if(cos<-.9999)throw Error('Anatomy: tube path reverses direction.');u=length<1e-9?previousU:add(add(mul(previousU,cos),cross(axis,previousU)),mul(axis,dot(axis,previousU)*(1-cos)/(length*length)));u=unit(sub(u,mul(tangent,dot(u,tangent))));}
  const v=unit(cross(tangent,u));frames.push({tangent,u,v});previousT=tangent;previousU=u;
 }
 const radial=(i,j)=>add(mul(frames[i].u,Math.cos(j*TAU/n)),mul(frames[i].v,Math.sin(j*TAU/n))),point=(i,j)=>add(path[i],mul(radial(i,j),a.radius));
 for(let i=0;i<path.length-1;i++)for(let j=0;j<n;j++){const nj=(j+1)%n,normal=add(add(radial(i,j),radial(i,nj)),add(radial(i+1,j),radial(i+1,nj)));b.quad(point(i,j),point(i,nj),point(i+1,nj),point(i+1,j),normal);}
 for(const [i,sign] of [[0,-1],[path.length-1,1]])for(let j=0;j<n;j++)b.triangle(path[i],point(i,j),point(i,(j+1)%n),mul(frames[i].tangent,sign));
}
/** Intrinsic Euler XYZ, matching THREE.Euler(x,y,z,'XYZ'). */
export function transformPoint(point,position=[0,0,0],rotation=[0,0,0]){
 const [rx,ry,rz]=rotation,[x,y,z]=point,cz=Math.cos(rz),sz=Math.sin(rz),cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx),zx=cz*x-sz*y,zy=sz*x+cz*y,yx=cy*zx+sy*z,yz=-sy*zx+cy*z;
 return [yx+position[0],cx*zy-sx*yz+position[1],sx*zy+cx*yz+position[2]];
}
const IDENTITY=[1,0,0,0,1,0,0,0,1];
const rotate=(r,p)=>[r[0]*p[0]+r[1]*p[1]+r[2]*p[2],r[3]*p[0]+r[4]*p[1]+r[5]*p[2],r[6]*p[0]+r[7]*p[1]+r[8]*p[2]];
function multiply(a,b){const r=[];for(let i=0;i<3;i++)for(let j=0;j<3;j++)r.push(a[i*3]*b[j]+a[i*3+1]*b[3+j]+a[i*3+2]*b[6+j]);return r;}
function eulerMatrix(rotation){const axes=[[1,0,0],[0,1,0],[0,0,1]].map(axis=>transformPoint(axis,[0,0,0],rotation));return [axes[0][0],axes[1][0],axes[2][0],axes[0][1],axes[1][1],axes[2][1],axes[0][2],axes[1][2],axes[2][2]];}
function matrixEuler(r){const y=Math.asin(Math.max(-1,Math.min(1,r[2])));return Math.abs(r[2])<.9999999?[Math.atan2(-r[5],r[8]),y,Math.atan2(-r[1],r[0])]:[Math.atan2(r[7],r[4]),y,0];}
function groupMotion(motion){
 if(!motion||motion.type==='fixed'||motion.value===0)return {r:IDENTITY,t:[0,0,0],active:false};
 if(motion.type==='slide')return {r:IDENTITY,t:mul(motion.axis,motion.value),active:true};
 const [x,y,z]=motion.axis,c=Math.cos(motion.value),s=Math.sin(motion.value),k=1-c,r=[c+x*x*k,x*y*k-z*s,x*z*k+y*s,y*x*k+z*s,c+y*y*k,y*z*k-x*s,z*x*k-y*s,z*y*k+x*s,c+z*z*k];
 return {r,t:sub(motion.pivot,rotate(r,motion.pivot)),active:true};
}
function posedParts(model){
 const groups=new Map(model.groups.map(group=>[group.id,group])),cache=new Map();
 const groupPose=id=>{if(cache.has(id))return cache.get(id);const group=groups.get(id),own=groupMotion(group.motion);let pose=own;if(group.parentId){const parent=groupPose(group.parentId);pose={r:multiply(parent.r,own.r),t:add(rotate(parent.r,own.t),parent.t),active:parent.active||own.active};}cache.set(id,pose);return pose;};
 return model.parts.map(part=>{if(!part.groupId)return part;const pose=groupPose(part.groupId);if(!pose.active)return part;return {...part,position:add(rotate(pose.r,part.position),pose.t),rotation:matrixEuler(multiply(pose.r,eulerMatrix(part.rotation)))};});
}
function boundsOf(positions,position=[0,0,0],rotation=[0,0,0]){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i+=3){const p=transformPoint(positions.slice(i,i+3),position,rotation);for(let j=0;j<3;j++){if(!Number.isFinite(p[j])||Math.abs(p[j])>100)throw Error('Anatomy: placed geometry exceeds the 100 m space.');min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}}return [min,max];}
export function compileModel(value){
 const model=normalizeModel(value),parts=[],bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];let triangles=0;
 // Group axes/pivots use the rest model's Y-up frame. Child motion is composed
 // before parent motion. Only the exported pose changes; the source recipe and
 // part-local vertices stay intact for later editing and educational motion.
 for(const part of posedParts(model)){const b=builder(),a=part.parameters;
  if(part.shape==='box'||part.shape==='roundedBox')box(a,b);
  else if(part.shape==='cylinder'||part.shape==='cone')lathe([[a.radius,-a.height/2],[part.shape==='cone'?a.radiusTop:a.radius,a.height/2]],a.segments,b);
  else if(part.shape==='sphere')sphere(a,b);
  else if(part.shape==='torus')torus(a,b);
  else if(part.shape==='lathe')lathe(a.profile,a.segments,b);
  else if(part.shape==='extrude')extrude(a,b);
  else if(part.shape==='tube')tube(a,b);
  else for(let i=0;i<a.positions.length;i+=9)b.triangle(a.positions.slice(i,i+3),a.positions.slice(i+3,i+6),a.positions.slice(i+6,i+9));
  if(!b.positions.length)throw Error('Anatomy: a part has no valid surface.');triangles+=b.positions.length/9;if(triangles>MODEL_LIMITS.triangles)throw Error('Anatomy: the complete model exceeds 60000 triangles.');
  const localBounds=boundsOf(b.positions),worldBounds=boundsOf(b.positions,part.position,part.rotation);for(let i=0;i<3;i++){bounds[0][i]=Math.min(bounds[0][i],worldBounds[0][i]);bounds[1][i]=Math.max(bounds[1][i],worldBounds[1][i]);}
  parts.push({...part,positions:b.positions,bounds:localBounds,worldBounds});
 }
 return {model,parts,stats:{parts:parts.length,triangles,bounds}};
}
