'use strict';
const cad=require('./cad'),m=require('@jscad/modeling'),p=m.primitives,t=m.transforms,b=m.booleans,e=m.extrusions,g2=m.geometries.geom2,g3=m.geometries.geom3;
const TAU=Math.PI*2,rad=n=>n*Math.PI/180;
const box=(a)=>{if(!(a.bevel>0))return p.cuboid({size:[a.width,a.depth,a.height]});if(a.bevel>=Math.min(a.width,a.depth,a.height)/2)throw Error('El chaflán debe ser menor que la mitad de la dimensión mínima.');const r=a.bevel;return m.hulls.hull(p.cuboid({size:[a.width,a.depth-2*r,a.height-2*r]}),p.cuboid({size:[a.width-2*r,a.depth,a.height-2*r]}),p.cuboid({size:[a.width-2*r,a.depth-2*r,a.height]}));};
const cylinder=(r,h,segments=20)=>p.cylinder({radius:r,height:h,segments});
const move=(x,y,z,shape)=>t.translate([x,y,z],shape);
const united=shapes=>shapes.length===1?shapes[0]:b.union(...shapes);
const regular=(radius,n)=>p.polygon({points:Array.from({length:n},(_,i)=>[radius*Math.cos(i*TAU/n),radius*Math.sin(i*TAU/n)])});
const tube=(a)=>b.subtract(cylinder(a.radius,a.height,a.segments),cylinder(Math.min(a.radius2,a.radius*.85),a.height+.002,a.segments));
const extrude=(shape,height)=>e.extrudeLinear({height},shape);
function toothProfile(a){return p.polygon({points:Array.from({length:a.teeth*4},(_,i)=>{const r=a.radius*(i%4===1||i%4===2?1:.83),theta=i*TAU/(a.teeth*4);return [Math.cos(theta)*r,Math.sin(theta)*r];})});}
function arcBody(a,span=TAU){return p.torus({innerRadius:Math.min(a.thickness,a.radius*.3),outerRadius:a.radius,innerSegments:8,outerSegments:a.segments,outerRotation:span});}
function segment(a,c,r,segments=10){const v=c.map((n,i)=>n-a[i]),length=Math.hypot(...v);if(length<1e-8)return p.sphere({radius:r,segments});const rotation=m.maths.mat4.fromVectorRotation(m.maths.mat4.create(),[0,0,1],v);return move(...a.map((n,i)=>(n+c[i])/2),t.transform(rotation,cylinder(r,length,segments)));}
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>{const n=Math.hypot(...a);if(n<1e-10)throw Error('La trayectoria contiene una tangente nula o una inversión de sentido.');return mul(a,1/n);};
function contour(points,radius=0,segments=20){
 let rows=points.map(point=>point.slice(0,2));if(rows.length>3&&Math.hypot(...sub(rows[0],rows.at(-1)))<1e-8)rows.pop();
 const area=rows.reduce((s,a,i)=>{const b=rows[(i+1)%rows.length];return s+a[0]*b[1]-a[1]*b[0];},0)/2;
 if(Math.abs(area)<1e-10)throw Error('El contorno necesita área y al menos tres vértices distintos.');if(area<0)rows.reverse();
 const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const on=(a,b,c)=>Math.abs(orient(a,b,c))<1e-10&&c[0]>=Math.min(a[0],b[0])-1e-10&&c[0]<=Math.max(a[0],b[0])+1e-10&&c[1]>=Math.min(a[1],b[1])-1e-10&&c[1]<=Math.max(a[1],b[1])+1e-10;
 for(let i=0;i<rows.length;i++){const a=rows[i],b=rows[(i+1)%rows.length];if(Math.hypot(...sub(a,b))<1e-8)throw Error('El contorno contiene vértices repetidos.');for(let j=i+2;j<rows.length;j++){if(i===0&&j===rows.length-1)continue;const c=rows[j],d=rows[(j+1)%rows.length];if(orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw Error('El contorno se cruza o se toca a sí mismo.');}}
 if(!radius)return rows;
 return rows.flatMap((at,i)=>{const prev=rows[(i+rows.length-1)%rows.length],next=rows[(i+1)%rows.length],u=unit(sub(at,prev)),v=unit(sub(next,at)),turn=Math.atan2(u[0]*v[1]-u[1]*v[0],dot(u,v));if(Math.abs(turn)<1e-6)return [at];if(Math.abs(turn)>Math.PI-1e-6)throw Error('No se puede redondear una esquina de 180°.');const distance=radius*Math.tan(Math.abs(turn)/2);if(distance>=Math.min(Math.hypot(...sub(at,prev)),Math.hypot(...sub(next,at)))*.49)throw Error('El radio del contorno supera el espacio de una arista. Reduce el radio.');const start=sub(at,mul(u,distance)),center=add(start,mul([-u[1],u[0]],Math.sign(turn)*radius)),angle=Math.atan2(start[1]-center[1],start[0]-center[0]),count=Math.max(1,Math.ceil(Math.abs(turn)/TAU*segments));return Array.from({length:count+1},(_,j)=>[center[0]+Math.cos(angle+turn*j/count)*radius,center[1]+Math.sin(angle+turn*j/count)*radius]);});
}
function strictlyInside(point,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[j],b=polygon[i],d=sub(b,a),length2=dot(d,d),q=length2?Math.max(0,Math.min(1,dot(sub(point,a),d)/length2)):0;if(Math.hypot(...sub(point,add(a,mul(d,q))))<1e-8)return false;if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function loopsCross(a,b){const orient=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]),on=(p,q,r)=>Math.abs(orient(p,q,r))<1e-10&&r[0]>=Math.min(p[0],q[0])-1e-9&&r[0]<=Math.max(p[0],q[0])+1e-9&&r[1]>=Math.min(p[1],q[1])-1e-9&&r[1]<=Math.max(p[1],q[1])+1e-9;return a.some((p,i)=>b.some((r,j)=>{const q=a[(i+1)%a.length],s=b[(j+1)%b.length];return orient(p,q,r)*orient(p,q,s)<0&&orient(r,s,p)*orient(r,s,q)<0||on(p,q,r)||on(p,q,s)||on(r,s,p)||on(r,s,q);}));}
function samplePath(points,smooth=false,segments=32){
 if(!smooth||points.length===2)return points.map(row=>row.slice());
 const interpolate=(p0,p1,p2,p3,u)=>{const t=[0];[p0,p1,p2,p3].slice(1).forEach((p,i)=>t.push(t[i]+Math.sqrt(Math.max(1e-10,Math.hypot(...sub(p,[p0,p1,p2][i]))))));const time=t[1]+u*(t[2]-t[1]),mix=(a,b,ta,tb)=>add(mul(a,(tb-time)/(tb-ta)),mul(b,(time-ta)/(tb-ta))),a1=mix(p0,p1,t[0],t[1]),a2=mix(p1,p2,t[1],t[2]),a3=mix(p2,p3,t[2],t[3]),b1=mix(a1,a2,t[0],t[2]),b2=mix(a2,a3,t[1],t[3]);return mix(b1,b2,t[1],t[2]);};
 const lengths=points.slice(1).map((p,i)=>Math.hypot(...sub(p,points[i]))),total=lengths.reduce((a,b)=>a+b,0),result=[points[0].slice()];
 points.slice(1).forEach((p,i)=>{const p0=i?points[i-1]:sub(mul(points[0],2),p),p3=points[i+2]||sub(mul(p,2),points[i]),count=Math.max(1,Math.round(segments*lengths[i]/total));for(let j=1;j<=count;j++)result.push(interpolate(p0,points[i],p,p3,j/count));});return result;
}
function transportFrames(points){
 let previousT,previousU;return points.map((at,i)=>{const tangent=unit(i===0?sub(points[1],at):i===points.length-1?sub(at,points[i-1]):add(unit(sub(at,points[i-1])),unit(sub(points[i+1],at))));let u;
  if(!previousT){const reference=Math.abs(tangent[0])<.85?[1,0,0]:[0,1,0];u=unit(sub(reference,mul(tangent,dot(reference,tangent))));}
  else{const axis=cross(previousT,tangent),length=Math.hypot(...axis),cos=dot(previousT,tangent);if(cos<-.99999)throw Error('El barrido no admite invertir la trayectoria 180°.');u=length<1e-9?previousU: add(add(mul(previousU,cos),mul(cross(mul(axis,1/length),previousU),length)),mul(axis,dot(axis,previousU)*(1-cos)/(length*length)));u=unit(sub(u,mul(tangent,dot(u,tangent))));}
  const v=unit(cross(tangent,u));previousT=tangent;previousU=u;return {position:at,u,v,tangent};});
}
function sweep(shape,points,a){const rows=samplePath(points,!!a.smoothPath,a.pathSegments),frames=transportFrames(rows),base=e.slice.fromSides(g2.toSides(shape));return e.extrudeFromSlices({numberOfSlices:frames.length,callback:(progress,index)=>{const frame=frames[index],twist=rad(a.twist||0)*progress,scale=1+((a.scale===undefined?1:a.scale)-1)*progress,u=add(mul(frame.u,Math.cos(twist)),mul(frame.v,Math.sin(twist))),v=add(mul(frame.v,Math.cos(twist)),mul(frame.u,-Math.sin(twist))),matrix=[...mul(u,scale),0,...mul(v,scale),0,...frame.tangent,0,...frame.position,1];return e.slice.transform(matrix,base);}},base);}
function hose(a,points){const rows=points||Array.from({length:7},(_,i)=>{const phi=i*Math.PI/12;return [Math.cos(phi)*a.radius,Math.sin(phi)*a.radius,i*a.height/6];});return sweep(p.circle({radius:a.thickness,segments:12}),rows,Object.assign({},a,{smoothPath:a.smoothPath===undefined?true:a.smoothPath,twist:0,scale:1}));}
function profile(id,a){const rect=()=>p.rectangle({size:[a.width,a.depth]}),circle=()=>p.circle({radius:a.radius,segments:a.segments});
 switch(id){
 case'rectangle':return rect();case'square':return p.square({size:a.width});case'roundedRectangle':return p.roundedRectangle({size:[a.width,a.depth],roundRadius:Math.min(a.round,a.width*.2,a.depth*.2),segments:a.segments});
 case'circle':return circle();case'ellipse':return p.ellipse({radius:[a.width/2,a.depth/2],segments:a.segments});case'triangle':return p.polygon({points:[[-a.width/2,-a.depth/2],[a.width/2,-a.depth/2],[0,a.depth/2]]});
 case'star':return p.star({vertices:a.teeth,outerRadius:a.radius,innerRadius:Math.min(a.radius2,a.radius*.8)});case'polygon':return regular(a.radius,a.sides);case'hexagon':return regular(a.radius,6);
 case'points':{const outer=contour(a.points||[[-a.width/2,-a.depth/2],[a.width/2,-a.depth/2],[a.width/2,a.depth/2],[-a.width/2,a.depth/2]],a.fillet,a.segments),body=p.polygon({points:outer}),holes=(a.loops||[]).map(loop=>p.polygon({points:contour(loop,a.fillet,a.segments)}));
  holes.forEach((hole,i)=>{const loop=g2.toOutlines(hole)[0];if(!loop.every(point=>strictlyInside(point,outer))||loopsCross(loop,outer))throw Error('Los huecos deben estar dentro del contorno exterior, sin tocarlo.');holes.slice(0,i).forEach(other=>{if(loopsCross(loop,g2.toOutlines(other)[0])||m.measurements.measureArea(b.intersect(hole,other))>1e-10)throw Error('Los huecos interiores no pueden solaparse ni tocarse.');});});return holes.length?b.subtract(body,...holes):body;}
 case'ring':return b.subtract(circle(),p.circle({radius:Math.min(a.radius2,a.radius*.85),segments:a.segments}));
 case'sector':{const span=Math.max(.05,Math.min(TAU,Math.abs(rad(a.angle))));return p.polygon({points:[[0,0],...Array.from({length:a.segments+1},(_,i)=>[Math.cos(i*span/a.segments)*a.radius,Math.sin(i*span/a.segments)*a.radius])]});}
 case'slot':return p.roundedRectangle({size:[a.width,a.depth],roundRadius:Math.min(a.width,a.depth)*.49,segments:a.segments});
 case'cross':return b.union(p.rectangle({size:[a.width,a.thickness]}),p.rectangle({size:[a.thickness,a.depth]}));
 case'lProfile':return b.union(move(-a.width/2+a.thickness/2,0,0,p.rectangle({size:[a.thickness,a.depth]})),move(0,-a.depth/2+a.thickness/2,0,p.rectangle({size:[a.width,a.thickness]})));
 case'uProfile':return b.subtract(rect(),move(0,a.thickness,0,p.rectangle({size:[Math.max(.0001,a.width-2*a.thickness),a.depth]})));
 case'tProfile':return b.union(p.rectangle({size:[a.thickness,a.depth]}),move(0,a.depth/2-a.thickness/2,0,p.rectangle({size:[a.width,a.thickness]})));
 case'iProfile':return b.union(p.rectangle({size:[a.thickness,a.depth]}),...[-1,1].map(s=>move(0,s*(a.depth/2-a.thickness/2),0,p.rectangle({size:[a.width,a.thickness]}))));
 case'keyhole':return b.union(circle(),move(0,-a.radius,0,p.rectangle({size:[a.radius*.65,a.radius*2]})));
 case'gear':return toothProfile(a);
 case'spline':{const controls=a.points||[[-a.width/2,0],[-a.width/3,-a.depth],[a.width/3,a.depth],[a.width/2,0]];let path=m.geometries.path2.fromPoints({},[controls[0].slice(0,2)]);path=m.geometries.path2.appendBezier({controlPoints:controls.slice(1).map(v=>v.slice(0,2)),segments:a.segments},path);return m.expansions.expand({delta:a.thickness,corners:'round',segments:8},path);}
 case'trapezoid':return p.polygon({points:[[-a.width/2,-a.depth/2],[a.width/2,-a.depth/2],[a.width*.3,a.depth/2],[-a.width*.3,a.depth/2]]});
 default:throw Error('Perfil no implementado.');}}
function solid(id,a){switch(id){
 case'box':return box(a);case'cube':return p.cube({size:a.width});case'roundedBox':return p.roundedCuboid({size:[a.width,a.depth,a.height],roundRadius:Math.min(a.round,a.width*.2,a.depth*.2,a.height*.2),segments:a.segments});
 case'sphere':return p.sphere({radius:a.radius,segments:a.segments});case'ellipsoid':return p.ellipsoid({radius:[a.width/2,a.depth/2,a.height/2],segments:a.segments});case'geodesic':return p.geodesicSphere({radius:a.radius,frequency:Math.max(6,Math.min(32,a.segments))});
 case'cylinder':return cylinder(a.radius,a.height,a.segments);case'ellipticCylinder':return p.cylinderElliptic({height:a.height,startRadius:[a.width/2,a.depth/2],endRadius:[a.width/2,a.depth/2],segments:a.segments});
 case'roundedCylinder':return p.roundedCylinder({radius:a.radius,height:a.height,roundRadius:Math.min(a.round,a.radius*.3,a.height*.2),segments:a.segments});
 case'cone':case'frustum':return p.cylinderElliptic({height:a.height,startRadius:[a.radius,a.radius],endRadius:id==='cone'?[0,0]:[Math.min(a.radius2,a.radius*.9),Math.min(a.radius2,a.radius*.9)],segments:a.segments});
 case'torus':return arcBody(a);case'torusArc':return arcBody(a,Math.max(.05,Math.min(TAU,Math.abs(rad(a.angle)))));case'tube':return tube(a);
 case'capsule':return p.roundedCylinder({height:Math.max(a.height,a.radius*2.1),radius:a.radius,roundRadius:a.radius*.99,segments:a.segments});
 case'pyramid':return p.polyhedron({points:[[-a.width/2,-a.depth/2,0],[a.width/2,-a.depth/2,0],[a.width/2,a.depth/2,0],[-a.width/2,a.depth/2,0],[0,0,a.height]],faces:[[3,2,1,0],[0,1,4],[1,2,4],[2,3,4],[3,0,4]],orientation:'outward'});
 case'wedge':return p.polyhedron({points:[[-a.width/2,-a.depth/2,0],[a.width/2,-a.depth/2,0],[-a.width/2,a.depth/2,0],[a.width/2,a.depth/2,0],[-a.width/2,-a.depth/2,a.height],[a.width/2,-a.depth/2,a.height]],faces:[[0,2,3,1],[0,1,5,4],[0,4,2],[1,3,5],[2,4,5,3]],orientation:'outward'});
 case'tetrahedron':return p.polyhedron({points:[[a.radius,a.radius,a.radius],[-a.radius,-a.radius,a.radius],[-a.radius,a.radius,-a.radius],[a.radius,-a.radius,-a.radius]],faces:[[0,2,1],[0,1,3],[0,3,2],[1,2,3]],orientation:'outward'});
 case'octahedron':return p.polyhedron({points:[[a.radius,0,0],[-a.radius,0,0],[0,a.radius,0],[0,-a.radius,0],[0,0,a.radius],[0,0,-a.radius]],faces:[[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]],orientation:'outward'});
 case'hexPrism':return extrude(regular(a.radius,6),a.height);case'polygonPrism':return extrude(regular(a.radius,a.sides),a.height);case'trough':return t.rotateX(Math.PI/2,b.subtract(cylinder(a.radius,a.length,a.segments),cylinder(Math.max(.0001,a.radius-a.thickness),a.length+.01,a.segments),move(0,-a.radius,0,p.cuboid({size:[a.radius*3,a.radius*2,a.length*2]}))));
 default:throw Error('Sólido no implementado.');}}
function part(id,a){const r=a.radius,h=a.height,th=a.thickness,n=a.segments;
 switch(id){
 case'plate':{const plate=box(Object.assign({},a,{height:th}));return b.subtract(plate,...[-1,1].flatMap(x=>[-1,1].map(y=>move(x*a.width*.35,y*a.depth*.35,0,cylinder(Math.min(r*.18,a.width*.1,a.depth*.1),th*3,n)))));}
 case'flange':return b.subtract(cylinder(r,th*2,n),cylinder(Math.min(a.radius2,r*.6),th*4,n),...Array.from({length:6},(_,i)=>move(Math.cos(i*TAU/6)*r*.78,Math.sin(i*TAU/6)*r*.78,0,cylinder(r*.07,th*4,12))));
 case'washer':return tube(Object.assign({},a,{height:th}));case'hexNut':return b.subtract(extrude(regular(r,6),h*.35),move(0,0,h*.15,cylinder(Math.min(a.radius2,r*.6),h,n)));
 case'bolt':return b.union(cylinder(r*.32,h,n),move(0,0,h/2,extrude(regular(r*.7,6),th*2)));
 case'socketScrew':return b.subtract(b.union(cylinder(r*.32,h,n),move(0,0,h/2,cylinder(r*.65,th*3,n))),move(0,0,h/2+th,extrude(regular(r*.3,6),th*4)));
 case'shaft':return b.union(cylinder(r*.5,h,n),cylinder(r,h*.22,n));case'spacer':return tube(Object.assign({},a,{height:th*3}));case'bushing':return b.subtract(b.union(cylinder(r,h,n),move(0,0,h/2-th,cylinder(r*1.1,th,n))),cylinder(Math.min(a.radius2,r*.85),h+.002,n));
 case'bearing':return b.union(tube(Object.assign({},a,{height:th*3,radius2:r*.78})),tube(Object.assign({},a,{height:th*3,radius:r*.6,radius2:r*.4})),...Array.from({length:8},(_,i)=>move(Math.cos(i*TAU/8)*r*.7,Math.sin(i*TAU/8)*r*.7,0,p.sphere({radius:r*.11,segments:8}))));
 case'pulley':return b.subtract(b.union(cylinder(r*.82,h*.7,n),...[-1,1].map(s=>move(0,0,s*h*.38,cylinder(r,h*.16,n)))),cylinder(r*.2,h*2,n));
 case'gear':return b.subtract(extrude(toothProfile(a),h*.4),move(0,0,h*.2,cylinder(r*.22,h,n)));
 case'rack':return b.union(box(Object.assign({},a,{height:th*3})),...Array.from({length:a.teeth},(_,i)=>move((i/(a.teeth-1)-.5)*a.width,0,th*2,p.cuboid({size:[a.width/a.teeth*.55,a.depth*.65,th*3]}))));
 case'knob':return b.union(cylinder(r*.75,h*.5,n),...Array.from({length:a.teeth},(_,i)=>move(Math.cos(i*TAU/a.teeth)*r*.72,Math.sin(i*TAU/a.teeth)*r*.72,0,cylinder(r*.23,h*.5,8))));
 case'handwheel':return b.union(arcBody(a),cylinder(r*.18,th*3,12),...Array.from({length:3},(_,i)=>t.rotateZ(i*TAU/3,move(r*.45,0,0,p.cuboid({size:[r*.9,th*1.2,th*1.2]})))));
 case'handle':return hose(a,[[-a.width/2,0,0],[-a.width/2,0,h],[a.width/2,0,h],[a.width/2,0,0]]);
 case'hinge':return b.union(...[-1,1].map(s=>move(s*a.width*.25,0,0,p.cuboid({size:[a.width*.45,a.depth,th]}))),t.rotateY(Math.PI/2,cylinder(th*2,a.width,12)));
 case'lBracket':return extrude(profile('lProfile',a),h);case'channel':return extrude(profile('uProfile',a),h);
 case'rail':return b.subtract(box(a),move(0,0,h*.35,p.cuboid({size:[a.width*.55,a.depth*1.1,h*.5]})));
 case'grille':{const base=box(Object.assign({},a,{height:th}));const holes=Array.from({length:Math.min(a.teeth,16)},(_,i)=>move((i/(Math.min(a.teeth,16)-1)-.5)*a.width*.8,0,0,p.cuboid({size:[a.width/(Math.min(a.teeth,16)*2),a.depth*.72,th*3]})));return b.subtract(base,...holes);}
 case'hose':return hose(a,a.points);case'spring':return e.extrudeHelical({angle:TAU*a.turns,pitch:a.pitch,segmentsPerRotation:n},p.circle({center:[r,0],radius:Math.min(th,r*.2),segments:8}));
 case'bellows':return united(Array.from({length:8},(_,i)=>move(0,0,i*h/8,arcBody(Object.assign({},a,{radius:r*(i%2?.94:1),thickness:th*.6})))));
 case'tank':return solid('roundedBox',Object.assign({},a,{round:Math.min(a.width,a.depth,a.height)*.2}));
 case'housing':return b.subtract(solid('roundedBox',a),move(0,0,th,box(Object.assign({},a,{width:Math.max(th,a.width-th*2),depth:Math.max(th,a.depth-th*2),height:h}))));
 case'seat':return b.union(solid('roundedBox',Object.assign({},a,{height:th*4,round:th})),move(0,-a.depth/2+th,h*.4,solid('roundedBox',Object.assign({},a,{height:h*.8,depth:th*4,round:th}))));
 case'fender':return t.rotateX(Math.PI/2,p.torus({innerRadius:Math.min(a.depth*.18,r*.25),outerRadius:r,outerRotation:Math.PI,innerSegments:8,outerSegments:n}));
 case'nameplate':{const text=String(a.text===undefined?'HELLO':a.text).slice(0,32),lines=m.text.vectorText({height:1},text),plate=box(Object.assign({},a,{height:th}));if(!lines.length)return plate;const points=lines.flat(),xmin=Math.min(...points.map(p=>p[0])),xmax=Math.max(...points.map(p=>p[0])),ymin=Math.min(...points.map(p=>p[1])),ymax=Math.max(...points.map(p=>p[1])),stroke=Math.min(th*.3,a.width*.008,a.depth*.025),factor=Math.min((a.width*.82-stroke*2)/(xmax-xmin||1),(a.depth*.68-stroke*2)/(ymax-ymin||1));const lettering=united(lines.map(points=>e.extrudeRectangular({size:stroke,height:th*.5},m.geometries.path2.fromPoints({},points.map(point=>[(point[0]-(xmin+xmax)/2)*factor,(point[1]-(ymin+ymax)/2)*factor])))));return b.union(plate,move(0,0,th*.49,lettering));}
 case'ribbedPanel':return b.union(box(Object.assign({},a,{height:th})),...Array.from({length:8},(_,i)=>move((i/7-.5)*a.width*.85,0,th,p.cuboid({size:[th,a.depth*.9,th*2]}))));
 default:throw Error('Pieza no implementada.');}}
function operate(tool,a,inputs){const [category,id]=tool.id.split('.'),input=inputs[0];
 if(category==='solid')return solid(id,a);if(category==='profile')return profile(id,a);if(category==='part')return part(id,a);
 if(!input)throw Error('Selecciona primero un cuerpo o perfil del historial.');
 if(tool.input==='3d'&&!g3.isA(input)||tool.input==='2d'&&!g2.isA(input))throw Error(tool.input==='2d'?'Esta operación necesita un perfil 2D.':'Esta operación necesita un sólido 3D.');
 if(category==='modify'){
 if(id==='translate')return t.translate([a.x,a.y,a.z],input);if(/^translate[XYZ]$/.test(id))return t[id](a[id.slice(-1).toLowerCase()],input);
 if(id==='rotate')return t.rotate([rad(a.angle),rad(a.angleY),rad(a.angleZ)],input);if(/^rotate[XYZ]$/.test(id))return t[id](rad(a.angle),input);
 if(id==='scale')return t.scale([a.scale,a.scale,a.scale],input);if(/^scale[XYZ]$/.test(id))return t[id](a.scale,input);if(/^mirror[XYZ]$/.test(id))return t[id](input);
 if(id==='center')return t.center({},input);if(id==='floor')return t.align({modes:['none','none','min'],relativeTo:[0,0,0]},input);
 const axis=id.slice(-1),modes=['none','none','none'];modes['XYZ'.indexOf(axis)]=id.includes('Min')?'min':'max';return t.align({modes,relativeTo:[0,0,0]},input);}
 if(category==='boolean'){
 if(['union','subtract','intersect','hull'].includes(id)){if(inputs.length<2)throw Error('Selecciona dos cuerpos del historial.');return id==='hull'?m.hulls.hull(...inputs):b[id](...inputs);}
 if(a.plane&&['drill','counterbore','countersink','slotCut'].includes(id)){const frame=a.plane,n=frame.normal,u=frame.xAxis,v=cross(n,u),bounds=m.measurements.measureBoundingBox(input),diameter=Math.hypot(...sub(bounds[1],bounds[0]))*2+.01,origin=add(frame.origin,add(mul(u,a.x),mul(v,a.y))),matrix=[...u,0,...v,0,...n,0,...origin,1],placed=shape=>t.transform(matrix,shape),radius=id==='drill'?a.radius:Math.min(a.radius2,a.radius*.85),hole=id==='slotCut'?move(0,0,-diameter,extrude(profile('slot',a),diameter*2)):cylinder(radius,diameter,a.segments),cuts=[placed(hole)];if(id==='counterbore')cuts.push(placed(move(0,0,-a.thickness/2+.0001,cylinder(a.radius,a.thickness+.0002,a.segments))));if(id==='countersink')cuts.push(placed(move(0,0,-a.thickness/2+.0001,p.cylinderElliptic({height:a.thickness+.0002,startRadius:[radius,radius],endRadius:[a.radius,a.radius],segments:a.segments}))));return b.subtract(input,...cuts);}
 const bounds=m.measurements.measureBoundingBox(input),height=bounds[1][2]-bounds[0][2],center=(bounds[0][2]+bounds[1][2])/2;
 const hole=move(a.x,a.y,center,cylinder(id==='drill'?a.radius:Math.min(a.radius2,a.radius*.85),Math.max(a.height,height*2+.01),a.segments));
 if(id==='drill')return b.subtract(input,hole);
 if(id==='counterbore')return b.subtract(input,hole,move(a.x,a.y,bounds[1][2]-a.thickness/2,cylinder(a.radius,a.thickness*1.1,a.segments)));
 if(id==='countersink')return b.subtract(input,hole,move(a.x,a.y,bounds[1][2]-a.thickness/2,p.cylinderElliptic({height:a.thickness,startRadius:[a.radius2,a.radius2],endRadius:[a.radius,a.radius],segments:a.segments})));
 if(id==='slotCut')return b.subtract(input,move(a.x,a.y,center-height,extrude(profile('slot',a),height*3+.01)));
 if(id==='crossCut')return b.subtract(input,move(a.x,a.y,a.z,box(a)));
 if(id==='shellBox')return b.subtract(input,move(0,0,a.thickness,box({width:Math.max(a.thickness,a.width-2*a.thickness),depth:Math.max(a.thickness,a.depth-2*a.thickness),height:a.height})));
 }
 if(category==='extrude'){
 if(id==='linear'||id==='emboss')return extrude(input,a.height);
 if(id==='symmetric')return move(0,0,-a.height/2,extrude(input,a.height));
 if(id==='twist')return e.extrudeLinear({height:a.height,twistAngle:rad(a.twist),twistSteps:Math.min(32,a.segments)},input);
 if(id==='revolve'||id==='revolveArc'){const bounds=m.measurements.measureBoundingBox(input),shift=Math.max(0,-bounds[0][0])+a.radius;return e.extrudeRotate({segments:a.segments,angle:id==='revolve'?TAU:Math.max(.05,Math.min(TAU,Math.abs(rad(a.angle))))},t.translateX(shift,input));}
 if(id==='profileTube')return extrude(b.subtract(input,m.expansions.offset({delta:-a.thickness,corners:'round',segments:8},input)),a.height);
 const base=e.slice.fromSides(g2.toSides(input));
 if(id==='sweep')return sweep(input,a.points||[[0,0,0],[a.x,a.y,a.height/2],[0,0,a.height]],a);
 if(id==='loft'&&inputs.length>1){if(inputs.some(row=>!g2.isA(row)))throw Error('Cada sección del loft debe ser un perfil 2D.');const sections=inputs.map((shape,index)=>{const progress=index/(inputs.length-1),frame=a.sections&&a.sections[index]||{position:[a.x*progress,a.y*progress,a.height*progress],rotation:[0,0,0],scale:[1,1]},rotation=m.maths.mat4.fromTaitBryanRotation(m.maths.mat4.create(),rad(frame.rotation[2]),rad(frame.rotation[1]),rad(frame.rotation[0])),scaled=e.slice.transform(m.maths.mat4.fromScaling(m.maths.mat4.create(),[...frame.scale,1]),e.slice.fromSides(g2.toSides(shape)));return e.slice.transform(m.maths.mat4.fromTranslation(m.maths.mat4.create(),frame.position),e.slice.transform(rotation,scaled));});return e.extrudeFromSlices({numberOfSlices:sections.length,callback:(_,index)=>sections[index]},sections[0]);}
 const upper=inputs[1]&&g2.isA(inputs[1])?e.slice.fromSides(g2.toSides(inputs[1])):null;
 return e.extrudeFromSlices({numberOfSlices:upper?2:Math.min(a.segments,16),callback:(progress)=>{if(upper)return e.slice.transform(m.maths.mat4.fromTranslation(m.maths.mat4.create(),[a.x*progress,a.y*progress,a.height*progress]),progress?upper:base);const factor=1+(a.scale-1)*progress;const matrix=m.maths.mat4.multiply(m.maths.mat4.create(),m.maths.mat4.fromTranslation(m.maths.mat4.create(),[id==='loft'?a.x*progress:0,id==='loft'?a.y*progress:0,a.height*progress]),m.maths.mat4.fromScaling(m.maths.mat4.create(),[factor,factor,1]));return e.slice.transform(matrix,base);}},base);
 }
 if(category==='pattern')return united(Array.from({length:a.count},(_,i)=>{if(/^linear[XYZ]$/.test(id))return t['translate'+id.slice(-1)](i*a.pitch,input);if(id==='grid')return move(i%Math.ceil(Math.sqrt(a.count))*a.pitch,Math.floor(i/Math.ceil(Math.sqrt(a.count)))*a.pitch,0,input);if(id==='stack')return move(i*a.x,i*a.y,i*a.pitch,input);if(id==='mirrorPair')return i%2?t.mirrorX(t.translateX(Math.ceil(i/2)*a.pitch,input)):t.translateX(Math.floor(i/2)*a.pitch,input);const angle=i*TAU/a.count*(id==='helix'?a.turns:1);return move(Math.cos(angle)*a.radius,Math.sin(angle)*a.radius,id==='helix'?i*a.pitch/a.count*a.turns:0,t.rotateZ(angle,input));}));
 if(category==='measure')return input;
 throw Error('Operación CAD no implementada: '+tool.id);
}
function triangulate(shape){const positions=[];g3.toPolygons(shape).forEach(poly=>{const vertices=m.geometries.poly3.toPoints(poly);for(let i=1;i<vertices.length-1;i++){const a=vertices[0],b=vertices[i],c=vertices[i+1];const cross=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];if(Math.hypot(...cross)<1e-12)continue;[a,b,c].forEach(v=>{if(v.some(value=>!Number.isFinite(value)||Math.abs(value)>100))throw Error('El diseño supera el espacio CAD de 100 metros o contiene coordenadas inválidas.');positions.push(v[0],v[2],-v[1]);});if(positions.length>cad.MAX_TRIANGLES*9)throw Error('El diseño supera60000 triángulos. Reduce segmentos o repeticiones.');}});if(!positions.length)throw Error('El resultado está vacío.');return positions;}
function compile(value){const recipe=cad.normalizeRecipe(value),shapes=new Map();let count=0;
 recipe.steps.forEach(step=>{const tool=cad.tools.find(t=>t.id===step.op),args=Object.assign(cad.defaults(step.op),step.params),inputs=step.inputs.map(id=>shapes.get(id));const result=operate(tool,args,inputs);if(!g3.isA(result)&&!g2.isA(result))throw Error('Resultado geométrico inválido.');const polygons=g3.isA(result)?g3.toPolygons(result):g2.toSides(result);count+=polygons.length;if(count>120000)throw Error('El historial supera el presupuesto de geometría.');shapes.set(step.id,result);});
 const result=shapes.get(recipe.output);if(!result)throw Error('Añade una operación al diseño.');const isProfile=g2.isA(result),display=isProfile?extrude(result,.003):result;
 const mesh={positions:triangulate(display)},bounds=m.measurements.measureBoundingBox(display),dimensions=bounds[1].map((v,i)=>v-bounds[0][i]);
 const center=m.measurements.measureCenterOfMass(result),polygons=isProfile?g2.toSides(result).length:g3.toPolygons(result).length;
 const stats={triangles:mesh.positions.length/9,steps:recipe.steps.length,volume:isProfile?0:Math.abs(m.measurements.measureVolume(result)),area:m.measurements.measureArea(result),dimensions:[dimensions[0],dimensions[2],dimensions[1]],bounds:[[bounds[0][0],bounds[0][2],-bounds[1][1]],[bounds[1][0],bounds[1][2],-bounds[0][1]]],center:[center[0],center[2],-center[1]],polygons};
 if(!isProfile&&(!(stats.volume>1e-14)||!stats.center.every(Number.isFinite)))throw Error('La geometría resultante no encierra un volumen válido. Revisa la posición y orientación de las secciones.');
 const operation=recipe.steps.find(step=>step.id===recipe.output).op;if(operation.startsWith('measure.'))stats.measurement={kind:operation.slice(8),value:stats[operation.slice(8)]};
 return {recipe,mesh,isProfile,stats};
}
module.exports={compile,operate,profile,solid,part,triangulate,contour,samplePath,transportFrames,sweep};
