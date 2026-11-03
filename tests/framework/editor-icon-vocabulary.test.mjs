import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../packages/tools/editor/src/EditorIcons.js',import.meta.url),'utf8').replace(/export function /g,'function ');
const {iconData,setEditorIcon}=new Function(source+'\nreturn {iconData,setEditorIcon};')();
test('local icons remain scalable SVGs independent of font glyphs and remote assets',()=>{
  for(const name of ['select','move','rotate','scale','save','practice','robot','vehicle','rack','conveyor','chip','mic','account','favorite']){
    const data=iconData(name);assert(data.startsWith('url("data:image/svg+xml,'));
    const svg=decodeURIComponent(data.slice(data.indexOf(',')+1,-2));
    assert(svg.includes('viewBox="0 0 24 24"'));assert(svg.includes('stroke-linecap="round"'));assert(svg.includes('stroke-width="1.7"'));assert(!svg.includes('<text'));assert(!svg.includes('<image'));assert(!svg.includes('<script'));
  }
  assert.notEqual(iconData('practice'),iconData('book'),'Practice and reference documentation have distinct symbols.');assert.notEqual(iconData('robot'),iconData('vehicle'));
});
test('decorating an existing command keeps the same action owner and accessible name',()=>{
  const classes=new Set(),attributes={},style={},events=['original-click-handler'];
  const control={textContent:'Mover',title:'Mover el objeto',events,style:{setProperty:(key,value)=>style[key]=value},classList:{add:value=>classes.add(value)},setAttribute:(key,value)=>attributes[key]=value};
  assert.equal(setEditorIcon(control,'move','Mover',true),control);assert.equal(control.events,events);assert.equal(control.events.length,1);assert.equal(attributes['aria-label'],'Mover');assert.equal(attributes['data-ed-icon'],'move');assert(classes.has('ed-icon-only'));assert(style['--ed-command-icon'].includes('data:image/svg+xml'));
});
