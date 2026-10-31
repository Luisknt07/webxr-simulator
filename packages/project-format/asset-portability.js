import {cloneData} from '../contracts/index.js';
import {readContentProject,createContentProject,contentHash} from './index.js';
const MAX_ASSET_BYTES=256*1024*1024,MIME=/^[a-zA-Z0-9!#$&^_.+-]{1,99}\/[a-zA-Z0-9!#$&^_.+-]{1,100}$/;
const problem=message=>{throw Object.assign(new Error(message),{code:'content_asset'});};
function planFor(restored){
  if(restored.descriptor.kind!=='studio')return [];
  const plan=[],ids=new Set();
  for(const record of restored.document.imports||[]){
    if(record.dataUrl!==undefined)continue;
    if(typeof record.id!=='string'||!record.id||record.id.length>240||ids.has(record.id)||typeof record.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.sha256)||record.url!=='/api/assets/'+record.sha256||typeof record.mime!=='string'||!MIME.test(record.mime)||!Number.isSafeInteger(record.size)||record.size<0||record.size>MAX_ASSET_BYTES)problem('An asset needs a valid owned blob, exact API hash, size and MIME metadata before it can travel with the project.');
    ids.add(record.id);
    plan.push({id:record.id,path:'Content/Assets/'+record.sha256+'.blob',sha256:record.sha256,size:record.size,mime:record.mime});
  }
  return plan;
}
export function portableContentAssetPlan(bundle){return planFor(readContentProject(bundle));}
function browserBase64(bytes){const chunks=[];for(let offset=0;offset<bytes.length;offset+=32768)chunks.push(String.fromCharCode(...bytes.subarray(offset,Math.min(offset+32768,bytes.length))));return globalThis.btoa(chunks.join(''));}
/** Callers may load only the locally declared, verified blobs in the plan.
 * Opaque generic module fields are never scanned for URLs or asset claims. */
export function withPortableContentAssets(bundle,assets,{encodeBase64=browserBase64}={}){
  const restored=readContentProject(bundle),plan=planFor(restored);if(!plan.length)return bundle;
  const document=cloneData(restored.document,{maxString:384*1024*1024,maxNodes:1000000,maxDepth:60}),byId=new Map(plan.map(entry=>[entry.id,entry]));
  for(const record of document.imports||[]){const entry=byId.get(record.id);if(!entry)continue;
    const bytes=assets instanceof Map?assets.get(entry.sha256):null;
    if(!(bytes instanceof Uint8Array)||bytes.length!==entry.size||contentHash(bytes)!==entry.sha256)problem('The project asset blob is missing or does not match its declared hash and size.');
    record.dataUrl='data:'+entry.mime+';base64,'+encodeBase64(bytes);delete record.url;delete record.sha256;
  }
  return createContentProject(document,{id:restored.descriptor.id,name:restored.descriptor.name,kind:restored.descriptor.kind,...(restored.descriptor.revision===undefined?{}:{revision:restored.descriptor.revision}),...(Object.hasOwn(restored,'moduleState')?{moduleState:restored.moduleState}:{})});
}
