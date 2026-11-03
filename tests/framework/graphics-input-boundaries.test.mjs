import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),native=require('../support/load-practice-scenes.cjs')(),cad=require('../../packages/tools/cad/schema/cad');
test('project, API, native equipment, environment and CAD colour boundaries reject unbounded CSS before the legacy Three parser',()=>{
 const f=native.fixture(),object=f.document.addPrimitive('hall','box'),styles=['rgb('+' '.repeat(50000),'hsl('+' '.repeat(50000),'rgb(1,2,3)','#123','red'];
 const before=native.THREE.Color.prototype.setStyle;let malformedCalls=0;
 native.THREE.Color.prototype.setStyle=function(style){if(styles.includes(style)){malformedCalls++;throw Error('Unvalidated legacy Color.setStyle');}return before.call(this,style);};
 try{
  for(const style of styles){
   const value={format:'hello-webxr-editor',version:1,imports:[],rooms:{hall:{overrides:[],additions:[{id:'custom-color-test',name:'Test',descriptor:{type:'box',color:style},position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1],visible:true}]}}};
   assert.throws(()=>native.validateDocument(value));assert.throws(()=>f.document._validate(value));assert.throws(()=>f.document.setProperty(object,'color',style));
   assert.throws(()=>native.schema.normalizeBehaviors([{...native.schema.defaultBehavior('product'),color:style}]));
   assert.throws(()=>native.schema.robots.normalize({frameColor:style}));assert.throws(()=>native.schema.vehicles.normalize({frameColor:style}));
   assert.throws(()=>native.schema.studio.normalize({environments:[{...native.schema.studio.defaultEnvironment('hall'),skyColor:style}]}));
   assert.throws(()=>cad.normalizeDescriptor({type:'cad',recipe:cad.preset('folded-panel'),mesh:{positions:[0,0,0,1,0,0,0,1,0]},color:style}));
  }
  assert.equal(malformedCalls,0,'Disallowed colour styles must never enter the vulnerable Three colour regular expression.');
  f.document.setProperty(object,'color','#12Ab34');assert.equal(f.document.getObject(object.userData.editorId),object);
 }finally{native.THREE.Color.prototype.setStyle=before;native.releaseGeometry(f);}
});
