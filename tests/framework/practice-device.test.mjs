import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const device=require('../../modules/logistica-industrial/practices/ui/PracticeDevice.cjs');
const navigation=require('../../modules/logistica-industrial/practices/schema/PracticeNavigation.cjs');
const browser=({coarse=false,touch=0,noHover=false,width=1440}={})=>({innerWidth:width,navigator:{maxTouchPoints:touch},matchMedia:query=>({matches:query==='(pointer: coarse)'?coarse:query==='(hover: none)'?noHover:false})});

test('automatic controls default to desktop and do not mistake a narrow window or touchscreen laptop for mobile',()=>{
 assert.equal(device.detect(), 'desktop');
 assert.equal(device.detect({window:browser({width:360})}), 'desktop');
 assert.equal(device.detect({window:browser({touch:10})}), 'desktop');
 assert.equal(device.detect({window:browser({coarse:true,touch:5,noHover:true})}), 'mobile');
 assert.equal(device.detect({window:browser({coarse:true,noHover:true})}), 'mobile');
 assert.equal(device.detect({window:{matchMedia(){throw Error('unavailable');}}}), 'desktop');
});

test('legacy URL device settings remain readable but cannot force controls for a new attempt',()=>{
 const input=new URLSearchParams('practice=CEDI-01&mode=manual&caseId=A&difficulty=1&device=vr');
 const legacy=navigation.readPracticeSettings(input).settings;
 assert.equal(legacy.device, 'vr');
 const touchContext={window:browser({coarse:true,touch:5,noHover:true})};
 const detected=device.settings(legacy,touchContext);
 assert.equal(detected.device, 'mobile');
 assert.equal(legacy.device, 'vr', 'Reading history must not mutate the saved attempt.');
 assert.equal(detected.mode, 'manual');
 assert.equal(device.settings({...legacy,device:'mobile'},{window:browser()}).device, 'desktop');
});

test('VR availability and a stale vrMode flag do not claim an active immersive session',()=>{
 const win=browser({coarse:true,touch:2,noHover:true});win.navigator.xr={isSessionSupported:()=>Promise.resolve(true)};
 const ctx={window:win,vrMode:true,renderer:{xr:{isPresenting:false,getSession:()=>null}}};
 assert.equal(device.detect(ctx), 'mobile');
 const session={visibilityState:'visible'};ctx.renderer.xr.getSession=()=>session;
 assert.equal(device.detect(ctx), 'mobile', 'An acquired session before renderer presentation is not an active control mode.');
 ctx.renderer.xr.isPresenting=true;
 assert.equal(device.detect(ctx), 'vr');
 ctx.renderer.xr.getSession=()=>null;
 assert.equal(device.detect(ctx), 'mobile');
 ctx.renderer.xr.getSession=()=>{throw Error('session closed');};
 assert.equal(device.detect(ctx), 'mobile');
});
