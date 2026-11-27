'use strict';
const packet=require('./original-navigation.json');
const fragmentShader='uniform float time;uniform float active;uniform sampler2D tex;varying vec2 vUv;void main(){vec4 col=texture2D(tex,vec2(vUv.x,vUv.y*3.0+time*2.0));col*=vUv.y;float brightness=max(col.r,max(col.g,col.b));col.rgb=mix(col.rgb,vec3(1.0,.81,.35)*brightness,active);gl_FragColor=col;}';
function create(T){
 const model=new T.Group(),material=new T.MeshBasicMaterial(),geometries=[];
 for(const name of ['goal','beam','glow']){const source=packet.meshes[name],geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(source.position,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(source.uv,2));geometry.setIndex(new T.Uint16BufferAttribute(source.index,1));geometry.computeBoundingBox();geometries.push(geometry);const mesh=new T.Mesh(geometry,material);mesh.name=name;model.add(mesh);}
 const texture=typeof Image==='undefined'?new T.DataTexture(new Uint8Array([32,140,255,220]),1,1,T.RGBAFormat):new T.Texture();let image=null,disposed=false;
 texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.generateMipmaps=false;texture.minFilter=texture.magFilter=T.LinearFilter;
 if(typeof Image!=='undefined'){image=new Image();image.onload=()=>{if(!disposed){texture.image=image;texture.needsUpdate=true;}};image.src='data:image/png;base64,'+packet.texturePng;}else texture.needsUpdate=true;
 return{model,texture,dispose(){if(disposed)return;disposed=true;if(image){image.onload=null;image.removeAttribute('src');}geometries.forEach(g=>g.dispose());material.dispose();texture.dispose();}};
}
module.exports={create,fragmentShader};
