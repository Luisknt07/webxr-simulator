import * as THREE from 'three';

// Native, vertex-coloured PPE character. One draw per articulated part, no
// textures, downloads, bones, physics bodies or changes to local XR joints.
export function createAvatarRig(config={}){
 const root=new THREE.Group(),torso=new THREE.Group(),head=new THREE.Group();root.add(torso,head);
 const geometry=[],material=new THREE.MeshStandardMaterial({vertexColors:THREE.VertexColors,roughness:.76,metalness:.03}),uniform=config.accentColor||'#26364b',vest=config.bodyColor||'#e7b33e',skin=config.skinColor||'#d4a77e',robot=config.base==='robot';
 const white='#e4eee9',dark='#182833',helmet=config.base==='explorer'?'#e9f0ed':vest;
 const sphere=()=>new THREE.SphereBufferGeometry(1,16,10),box=()=>new THREE.BoxBufferGeometry(1,1,1),cylinder=()=>new THREE.CylinderBufferGeometry(1,1,1,12);
 const roundedBox=()=>{const shape=new THREE.Shape();shape.moveTo(-.45,-.45);shape.lineTo(.45,-.45);shape.lineTo(.45,.45);shape.lineTo(-.45,.45);shape.closePath();const g=new THREE.ExtrudeBufferGeometry(shape,{depth:.9,steps:1,bevelEnabled:true,bevelSize:.05,bevelThickness:.05,bevelSegments:2,curveSegments:1});g.translate(0,0,-.45);return g;};
 function part(parent,rows){
  const ps=[],ns=[],cs=[];
  for(const [source,color,position,scale,rotation]of rows){let g=source.index?source.toNonIndexed():source;const m=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation||[0,0,0]))),new THREE.Vector3().fromArray(scale));if(g.applyMatrix4)g.applyMatrix4(m);else g.applyMatrix(m);const p=g.attributes.position.array,n=g.attributes.normal.array,c=new THREE.Color(color).convertSRGBToLinear();for(let i=0;i<p.length;i+=3){ps.push(p[i],p[i+1],p[i+2]);ns.push(n[i],n[i+1],n[i+2]);cs.push(c.r,c.g,c.b);}g.dispose();if(g!==source)source.dispose();}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(ns,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cs,3));g.computeBoundingSphere();geometry.push(g);const mesh=new THREE.Mesh(g,material);mesh.raycast=()=>{};parent.add(mesh);return mesh;
 }
 const h=[[sphere(),robot?'#c5d1d7':skin,[0,-.035,0],[.137,.173,.133]],[sphere(),robot?'#c5d1d7':skin,[0,-.16,-.007],[.105,.074,.107]]];
 if(robot){h.push([box(),dark,[0,.005,-.119],[.214,.065,.038]]);for(const side of [-1,1])h.push([box(),'#62e7d0',[side*.05,.005,-.142],[.035,.018,.005]]);h.push([box(),dark,[0,-.12,-.107],[.075,.012,.012]]);}
 else{
  h.push([sphere(),skin,[0,-.045,-.137],[.024,.043,.026]],[box(),'#946755',[0,-.128,-.107],[.05,.008,.009]]);
  for(const side of [-1,1])h.push([sphere(),skin,[side*.134,-.042,0],[.027,.045,.023]],[sphere(),white,[side*.05,.001,-.12],[.025,.014,.009]],[sphere(),dark,[side*.05,.001,-.129],[.009,.011,.004]],[box(),'#49382f',[side*.05,.028,-.126],[.047,.007,.009]]);
 }
 h.push([new THREE.SphereBufferGeometry(1,20,10,0,Math.PI*2,0,Math.PI/2),helmet,[0,.078,.005],[.171,.108,.163]],[cylinder(),helmet,[0,.078,-.008],[.184,.017,.182]],[box(),helmet,[0,.181,.006],[.027,.016,.235]],[box(),white,[0,.119,-.158],[.066,.031,.008]],[box(),uniform,[0,.119,-.164],[.041,.012,.004]]);
 part(head,h);
 const profile=[[0,-.9],[.15,-.9],[.176,-.85],[.18,-.68],[.225,-.43],[.205,-.37],[.125,-.33],[0,-.33]].map(([x,y])=>new THREE.Vector2(x,y));
 const body=[[new THREE.LatheBufferGeometry(profile,24),uniform,[0,0,0],[1,1,.66]],[cylinder(),robot?'#b5c5cb':skin,[0,-.278,0],[.061,.115,.057]],[sphere(),uniform,[0,-.92,0],[.171,.105,.117]],[box(),dark,[0,-.86,0],[.31,.038,.225]],[box(),'#aabcbf',[0,-.86,-.119],[.045,.031,.012]]];
 for(const side of [-1,1])body.push([roundedBox(),vest,[side*.099,-.568,-.122],[.176,.405,.038]],[box(),white,[side*.103,-.482,-.145],[.025,.21,.006]],[box(),uniform,[side*.09,-.718,-.15],[.11,.079,.012]],[sphere(),uniform,[side*.222,-.406,0],[.071,.085,.091]]);
 body.push([box(),vest,[0,-.56,.115],[.32,.39,.028]],[box(),white,[0,-.648,-.148],[.369,.026,.007]],[box(),white,[0,-.648,.134],[.32,.026,.007]],[box(),dark,[0,-.56,-.147],[.012,.42,.008]],[box(),white,[.1,-.536,-.151],[.06,.045,.009]],[box(),uniform,[.1,-.536,-.158],[.042,.009,.003]]);part(torso,body);
 const hands={},arms={},legs={};
 for(const side of ['left','right']){
  const sign=side==='left'?-1:1,upper=new THREE.Group(),lower=new THREE.Group(),hand=new THREE.Group();root.add(upper,lower,hand);arms[side]={upper,lower};hands[side]=hand;
  part(upper,[[cylinder(),uniform,[0,-.15,0],[.062,.3,.063]],[cylinder(),vest,[0,-.045,0],[.066,.08,.067]]]);
  part(lower,[[cylinder(),uniform,[0,-.14,0],[.049,.28,.05]],[cylinder(),white,[0,-.205,0],[.052,.025,.053]]]);
  const glove=[[roundedBox(),vest,[0,-.012,0],[.066,.075,.038]],[box(),uniform,[0,.036,0],[.07,.025,.045]],[sphere(),vest,[sign*-.035,-.014,-.011],[.018,.034,.018]]];
  for(let finger=0;finger<4;finger++)glove.push([sphere(),vest,[(finger-1.5)*.015,-.058,-.003],[.009,.027-finger*.001,.017]]);part(hand,glove);
  const hip=new THREE.Group(),knee=new THREE.Group();torso.add(hip);hip.position.set(sign*.095,-.94,0);hip.add(knee);knee.position.y=-.33;legs[side]={hip,knee};
  part(hip,[[cylinder(),uniform,[0,-.165,0],[.077,.33,.083]],[box(),dark,[0,-.291,-.067],[.097,.082,.024]]]);
  part(knee,[[cylinder(),uniform,[0,-.14,0],[.062,.28,.067]],[roundedBox(),dark,[0,-.291,-.04],[.121,.101,.229]],[box(),'#34414a',[0,-.34,-.04],[.124,.018,.232]]]);
 }
 return{root,head,torso,hands,arms,legs,dispose(){if(root.parent)root.parent.remove(root);geometry.forEach(g=>g.dispose());material.dispose();}};
}
