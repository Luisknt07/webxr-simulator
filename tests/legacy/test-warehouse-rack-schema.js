'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const racks=require('../../modules/logistica-industrial/functions/almacenamiento/schema/warehouseRacks'),queues=require('../../modules/logistica-industrial/functions/almacenamiento/schema/palletQueues');
const cases=[
  [{},'a3bb0c457c8ddee4fec40a35d3edcd4b7c517fa582d0d07245631db918d8deda'],
  [{rackSystem:'floor'},'f898a2728cad3ead5162ab89d95c1408c3549116b836bdd9544eafb4fa726d29'],
  [{acceptsPallets:true,palletType:'euro-1200x800',palletCapacity:2,capacity:2},'884f0817b90463e801619837144e460c2e237d39cb39cd38b4e758422c12f739'],
  [{layoutMode:'fit',palletCapacity:4,capacity:80,columns:3,rows:2,layers:5,width:1.7,depth:1.2},'bcf6dee36a410238cc7012609272cd86d147a4a5efb7980f5c2675a4d62f103e'],
  [{width:2,depth:1.4,columns:5,rows:4,layers:3,palletCapacity:3,capacity:120,palletMaterial:'plastic'},'6f478d68fb4b359b21e9d1bf3f30127282ac72aa995b9d3ab59fae05bdc56eca']
];
// These hashes were captured from the committed pre-rack algorithm, including
// property order and exact numbers: old stocks are not silently re-authored.
for(const [config,expected] of cases){const actual={config:queues.settings(config),layout:queues.layout(config),quotas:[0,1,2,3].map(i=>queues.bayCapacity(queues.settings(config),i))};assert.equal(crypto.createHash('sha256').update(JSON.stringify(actual)).digest('hex'),expected);}
assert.equal(racks.SYSTEMS.length,14);assert.equal(new Set(racks.SYSTEMS.map(s=>s.id)).size,14);assert.equal(queues.racks,racks);
function assertCellEnvelopes(layout,label){
  const b=layout.bounds,epsilon=1e-9;
  for(const cell of layout.cells){
    const p=cell.position;
    assert(p[0]-cell.width/2>=b[0]-epsilon&&p[0]+cell.width/2<=b[3]+epsilon,label+': full cell width is inside authoring bounds.');
    assert(p[2]-cell.depth/2>=b[2]-epsilon&&p[2]+cell.depth/2<=b[5]+epsilon,label+': full cell depth is inside authoring bounds.');
    assert(p[1]>=b[1]-epsilon&&p[1]+cell.clearHeight<=b[4]+epsilon,label+': support and usable load height are inside authoring bounds.');
  }
}
for(const system of racks.SYSTEMS){
  const config=racks.normalize(racks.defaults(system.id)),layout=queues.layout(config);
  assert.deepEqual(racks.normalize(config),config,'Rack normalization is stable on reopening.');
  assert(layout.rack);assert.equal(config.capacity,layout.cells.length);assert.equal(config.palletCapacity,layout.cells.length);assert(layout.cells.length>=1&&layout.cells.length<=128);
  assert.equal(layout.slots,layout.cells);assert.equal(layout.floor,-1);assert.equal(config.columns*config.rows*config.layers,1);assert.equal(config.palletHeight,0);
  assert.equal(config.acceptsPallets,system.acceptedLoad==='pallet');assert.equal(layout.pallets.length,layout.cells.length);
  const keys=new Set();layout.cells.forEach((cell,index)=>{
    const key=[cell.bank,cell.bay,cell.level,cell.column,cell.depthIndex].join(':');assert(!keys.has(key));keys.add(key);
    assert.equal(cell.index,index);assert.equal(cell.palletIndex,index);assert.equal(cell.localSlot,0);assert.equal(layout.pallets[index].top,cell.position[1]);assert.equal(queues.bayCapacity(config,index),1);
    assert.deepEqual(layout.pallets[index].position,cell.position);assert(cell.width>.14&&cell.depth>.14&&cell.clearHeight>.14);
    assert(cell.position.every(Number.isFinite));assert(cell.capacityKg>0&&cell.levelCapacityKg>0);
    const b=layout.bounds;assert(cell.position[0]>=b[0]&&cell.position[0]<=b[3]&&cell.position[1]>=b[1]&&cell.position[1]<=b[4]&&cell.position[2]>=b[2]&&cell.position[2]<=b[5]);
    if(cell.depthIndex){const front=layout.cells.find(other=>other.lane===cell.lane&&other.depthIndex===0);assert(cell.position[2]<front.position[2]);if(system.mechanism==='gravity'||system.mechanism==='push-back')assert(cell.position[1]>front.position[1]);}
  });
  assert.equal(queues.bayCapacity(config,config.capacity),0);
  assert.equal(layout.input.face,system.loadFace);assert.equal(layout.output.face,system.pickFace);assert(layout.input.tx**2+layout.input.tz**2===1);assert(layout.output.tx**2+layout.output.tz**2===1);
  assertCellEnvelopes(layout,system.id+' default');
  const minimum={...racks.defaults(system.id),rackBays:1,rackLevels:1,rackColumns:1,rackDepthSlots:1,rackBanks:1,rackBayWidth:.8,rackSlotDepth:.4,rackLevelHeight:.4,rackBaseHeight:0,rackClearance:.02};
  if(system.id==='mezzanine')Object.assign(minimum,{rackBayWidth:2.4,rackBaseHeight:2.1});
  assertCellEnvelopes(racks.layout(minimum),system.id+' minimum legal dimensions');
}
for(const id of ['pallet-flow','push-back','carton-flow']){
  const extreme=racks.layout({...racks.defaults(id),rackSlope:.12,rackDepthSlots:6,rackSlotDepth:3,rackLevels:2,rackBays:1,rackColumns:1});
  const rearTop=Math.max(...extreme.cells.map(cell=>cell.position[1]+cell.clearHeight));
  assertCellEnvelopes(extreme,id+' maximum incline/depth');
  assert(extreme.bounds[4]>=rearTop+.22-1e-9,id+': raised rear clearance and top framing determine the true height.');
  assert.equal(extreme.height,extreme.bounds[4]-extreme.floor);
}
const direct=racks.layout(racks.defaults('selective'));assert(direct.input.z>direct.frontZ);assert(direct.output.z>direct.frontZ);assert.equal(direct.input.x,direct.output.x);assert.equal(direct.input.y,direct.cells[0].position[1]);assert.equal(direct.inputSeatIndex,0);assert.equal(direct.outputSeatIndex,0);
const flow=racks.layout(racks.defaults('pallet-flow'));assert(flow.input.z<flow.backZ&&flow.output.z>flow.frontZ);assert.equal(flow.definition.policy,'fifo');
assert(flow.input.y>flow.output.y,'Gravity intake follows the higher real rear support, not an arbitrary transfer height.');
const through=racks.layout(racks.defaults('drive-through'));assert(through.input.z>through.frontZ&&through.output.z<through.backZ);
const deep=racks.normalize({...racks.defaults('double-deep'),rackDepthSlots:5});assert.equal(deep.rackDepthSlots,2);
const vlm=racks.normalize({...racks.defaults('vertical-lift'),rackBays:4,rackColumns:3});assert.equal(vlm.rackBays,1);assert.equal(vlm.rackColumns,1);
const lift=racks.layout(vlm);assert(lift.shaftPosition[1]-vlm.rackSlotDepth/2>lift.frontZ);assert(lift.accessPosition[2]>lift.shaftPosition[1]);
assert.deepEqual(lift.input.supportPosition,lift.accessPosition);assert.equal(lift.input.x,0);assert.equal(lift.output.x,0);
const tallWindow=racks.layout({...racks.defaults('vertical-lift'),rackLevels:1,rackTransferHeight:6,rackSlotDepth:3});assert(tallWindow.bounds[4]>=tallWindow.accessPosition[1]+tallWindow.cells[0].clearHeight+.3);assert(tallWindow.bounds[5]>tallWindow.accessPosition[2]+tallWindow.cells[0].depth/2);
const mezz=racks.layout(racks.defaults('mezzanine'));assert(mezz.bounds[5]>mezz.frontZ+3);assert.equal(mezz.input.y,-1+mezz.config.rackBaseHeight,'Mezzanine conveyors can meet the elevated platform.');
const reduced=racks.normalize({...racks.defaults('selective'),rackBays:1,rackLevels:1,rackColumns:1,rackSelectedSlot:127});assert.equal(reduced.rackSelectedSlot,0,'Reducing authored capacity keeps the selected slot valid.');
for(const changed of [{rackBaseHeight:1},{rackLevels:2,rackLevelHeight:1.5},{rackBays:1,rackBayWidth:1.5}])assert.throws(()=>racks.normalize({...racks.defaults('mezzanine'),...changed}),/mezzanine/);
const mobile=racks.defaults('mobile');assert.deepEqual(racks.mobileOffset(mobile,0,1),[0,0,0]);assert.deepEqual(racks.mobileOffset(mobile,1,1),[0,0,-mobile.rackAisleWidth]);assert.deepEqual(racks.mobileOffset(mobile,2,1),[0,0,-mobile.rackAisleWidth]);
const opened=racks.layout({...mobile,rackOpenAisle:1});opened.cells.forEach(cell=>assert.equal(cell.position[2]-cell.closedPosition[2],cell.bank>=1?-mobile.rackAisleWidth:0));
for(const bad of [{rackSystem:'unknown'},{...racks.defaults('selective'),rackBays:2.5},{...racks.defaults('selective'),rackSlotDepth:NaN},{...racks.defaults('selective'),rackSkuPolicy:'magic'},{...racks.defaults('drive-in'),rackBays:8,rackLevels:6,rackDepthSlots:6},{...racks.defaults('selective'),rackBayWidth:.8,rackColumns:3,rackClearance:.3}])assert.throws(()=>racks.normalize(bad));
assert(racks.FIELDS.every(field=>field.key&&field.label&&field.input&&Object.hasOwn(field,'default')));
console.log('Warehouse rack schema: 14 bounded configurable families, canonical legacy hashes, exact support seats, depth/access policies, mass/clearance limits, mobile gaps and separate lift/miniload docks passed.');
