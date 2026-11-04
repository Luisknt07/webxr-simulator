'use strict';

// Portable, inert Float32 storage for baked triangle coordinates. Explicit
// little-endian bytes agree with the BufferGeometry already sent to WebGL.
// This is opt-in: ordinary editable recipe arrays retain their original values.
const ENCODING='float32-le-base64',ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function invalid(){throw Error('Malla CAD fuera del límite.');}
function validate(values,maxCoordinates){
 if(!Array.isArray(values)||values.length<9||values.length>maxCoordinates||values.length%9)invalid();
 for(const value of values)if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>100)invalid();
 let surface=false;
 for(let i=0;i<values.length&&!surface;i+=9){const ax=values[i+3]-values[i],ay=values[i+4]-values[i+1],az=values[i+5]-values[i+2],bx=values[i+6]-values[i],by=values[i+7]-values[i+1],bz=values[i+8]-values[i+2];surface=Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)>1e-12;}
 if(!surface)throw Error('La malla CAD no tiene superficies válidas.');return values;
}
function shape(value,maxCoordinates){
 if(!plain(value))invalid();const fields=Object.getOwnPropertyDescriptors(value);
 if(Object.keys(fields).length!==3||Object.keys(fields).some(key=>!['encoding','count','data'].includes(key)||fields[key].get||fields[key].set))invalid();
 if(value.encoding!==ENCODING||!Number.isSafeInteger(value.count)||value.count<9||value.count>maxCoordinates||value.count%9||typeof value.data!=='string')invalid();
 const bytes=value.count*4;if(value.data.length!==Math.ceil(bytes/3)*4)invalid();return bytes;
}
function decode(value,maxCoordinates){
 if(Array.isArray(value))return validate(Array.from(value),maxCoordinates);
 const size=shape(value,maxCoordinates),data=value.data,bytes=new Uint8Array(size);let offset=0;
 const digit=char=>{const n=char.charCodeAt(0);return n>=65&&n<=90?n-65:n>=97&&n<=122?n-71:n>=48&&n<=57?n+4:n===43?62:n===47?63:-1;};
 for(let i=0;i<data.length;i+=4){const last=i===data.length-4,a=digit(data[i]),b=digit(data[i+1]),c=data[i+2]==='='?-2:digit(data[i+2]),d=data[i+3]==='='?-2:digit(data[i+3]);
  if(a<0||b<0||c===-1||d===-1||(!last&&(c<0||d<0)))invalid();
  const remaining=size-offset;if(remaining>=3&&(c<0||d<0)||remaining===2&&(c<0||d!==-2||(c&3)!==0)||remaining===1&&(c!==-2||d!==-2||(b&15)!==0))invalid();
  bytes[offset++]=(a<<2)|(b>>4);if(remaining>1)bytes[offset++]=((b&15)<<4)|(c>>2);if(remaining>2)bytes[offset++]=((c&3)<<6)|d;
 }
 const view=new DataView(bytes.buffer),values=new Array(value.count);for(let i=0;i<values.length;i++)values[i]=view.getFloat32(i*4,true);return validate(values,maxCoordinates);
}
function normalize(value,maxCoordinates){if(Array.isArray(value))return decode(value,maxCoordinates);decode(value,maxCoordinates);return{encoding:ENCODING,count:value.count,data:value.data};}
function encode(value,maxCoordinates){
 const values=decode(value,maxCoordinates),bytes=new Uint8Array(values.length*4),view=new DataView(bytes.buffer);for(let i=0;i<values.length;i++)view.setFloat32(i*4,values[i],true);
 // Float32 rounding must not turn a formerly valid tiny surface into a point.
 validate(Array.from(new Float32Array(values)),maxCoordinates);
 const chunks=[];let chunk='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];chunk+=ALPHABET[a>>2]+ALPHABET[((a&3)<<4)|((b||0)>>4)]+(i+1<bytes.length?ALPHABET[((b&15)<<2)|((c||0)>>6)]:'=')+(i+2<bytes.length?ALPHABET[c&63]:'=');if(chunk.length>=16384){chunks.push(chunk);chunk='';}}if(chunk)chunks.push(chunk);
 return{encoding:ENCODING,count:values.length,data:chunks.join('')};
}
module.exports={ENCODING,decode,normalize,encode};
