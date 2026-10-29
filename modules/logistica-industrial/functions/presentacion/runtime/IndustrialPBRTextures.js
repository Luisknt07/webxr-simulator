import * as THREE from 'three';
import pbr from '../schema/industrial-pbr.js';
const EDGES={economy:256,balanced:512,high:1024,ultra:1024};
function load(url,signal){return new Promise((resolve,reject)=>{const image=new Image();const finish=()=>{image.onload=image.onerror=null;if(signal)signal.removeEventListener('abort',abort);};const abort=()=>{finish();image.src='';reject(Error('Material cancelado.'));};image.onload=()=>{finish();resolve(image);};image.onerror=()=>{finish();reject(Error('No se pudo cargar '+url));};if(signal)signal.addEventListener('abort',abort,{once:true});image.src=url;});}

/** One shared mipmapped texture per material/channel/tier, active-room only. */
export default class IndustrialPBRTextures {
 constructor(ctx,changed,options={}){this.ctx=ctx;this.changed=changed;this.options=options;this.entries=new Map();this.generation=0;this.statistics={loads:0,failures:0};}
 edge(){const limits=this.ctx.graphics&&this.ctx.graphics.getLimits?this.ctx.graphics.getLimits():{tier:'balanced'};const n=Math.min(EDGES[limits.tier]||512,limits.textureEdge||1024,this.ctx.vrMode?512:1024);return n>=1024?1024:n>=512?512:256;}
 acquire(id){const edge=this.edge(),key=id+':'+edge;let entry=this.entries.get(key);if(entry)return entry;
  const generation=this.generation,abort=typeof AbortController==='function'?new AbortController():null;entry={id,edge,key,textures:null,pending:true,abort};this.entries.set(key,entry);this.statistics.loads++;
  const loader=this.options.load||load;entry.ready=Promise.all(['neutral','normal','roughness'].map(channel=>loader(pbr.path(id,channel,edge),abort&&abort.signal))).then(images=>{if(generation!==this.generation||this.entries.get(key)!==entry)return;const textures={};['neutral','normal','roughness'].forEach((channel,i)=>{const texture=new THREE.Texture(images[i]);texture.name='PBR CC0 · '+id+' · '+channel;texture.encoding=channel==='neutral'?THREE.sRGBEncoding:THREE.LinearEncoding;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=Math.min(4,this.ctx.renderer&&this.ctx.renderer.capabilities.getMaxAnisotropy?this.ctx.renderer.capabilities.getMaxAnisotropy():1);texture.userData={sharedIndustrialTexture:true,industrialPhotographicSource:id,industrialPhotographicKey:key};texture.needsUpdate=true;textures[channel]=texture;});entry.pending=false;entry.textures=textures;if(this.changed)this.changed();}).catch(()=>{if(generation!==this.generation||this.entries.get(key)!==entry)return;entry.pending=false;entry.failed=true;this.statistics.failures++;if(this.changed)this.changed();});return entry;
 }
 prune(wanted){this.entries.forEach((entry,key)=>{if(wanted.has(key))return;this.release(entry);this.entries.delete(key);});}
 // A renderer/UV wrapper may still borrow the immutable CPU image. Dispose
 // relinquishes this GPU owner; the image is collected with its last consumer.
 release(entry){if(entry.abort)entry.abort.abort();if(entry.textures)Object.values(entry.textures).forEach(texture=>texture.dispose());}
 dispose(){this.generation++;this.entries.forEach(entry=>this.release(entry));this.entries.clear();}
 stats(){let textures=0,bytes=0;this.entries.forEach(e=>{if(e.textures){textures+=3;bytes+=e.edge*e.edge*4*4/3*3;}});return Object.assign({},this.statistics,{profiles:this.entries.size,textures,estimatedGPUBytes:Math.round(bytes),edge:this.edge(),source:'CC0 local · ambientCG / Poly Haven'});}
}
