import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import config from '../../tooling/deploy/university/configure.cjs';
const options={appHost:'sim.university.example',mediaHost:'voice.university.example',turnHost:'turn.university.example',publicIP:'203.0.113.10'};
test('private deployment configuration uses only university services and never overwrites an existing secret',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'smarttwin-university-'));
 try{config.write({...options,directory});const env=fs.readFileSync(path.join(directory,'runtime.env'),'utf8'),media=fs.readFileSync(path.join(directory,'livekit.yaml'),'utf8'),key=env.match(/SMARTTWIN_ROOM_API_SECRET=([^\n]+)/)[1];assert(key.length>=64);assert(media.includes(key));assert(env.includes('wss://voice.university.example'));assert(media.includes('use_external_ip: false'));assert(media.includes('max_participants: 10'));assert(!env.includes('livekit.cloud'));assert(!media.includes('google.com'));assert.throws(()=>config.write({...options,directory}));assert.equal(fs.readFileSync(path.join(directory,'runtime.env'),'utf8'),env);assert.throws(()=>config.configuration({...options,publicIP:'unknown'}));assert.throws(()=>config.configuration({...options,appHost:'good.example\nmalicious'}));assert.throws(()=>config.configuration({...options,privateKey:'/etc/../private.pem'}));}
 finally{assert.equal(path.dirname(fs.realpathSync(directory)),fs.realpathSync(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
});
test('the local browser media SDK matches its reviewed integrity receipt',()=>{
 const root=new URL('../../packages/tools/collaboration/assets/livekit/',import.meta.url),receipt=JSON.parse(fs.readFileSync(new URL('provenance.json',root)));assert.equal(receipt.version,'2.25.0');assert.equal(receipt.license,'Apache-2.0');for(const entry of receipt.files)assert.equal(createHash('sha256').update(fs.readFileSync(new URL(entry.path,root))).digest('hex'),entry.sha256);
});
