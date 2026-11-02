/* Shared processor geometry: editor ports, visual stations and live product flow. */
'use strict';

const modes = ['process', 'combiner', 'separator'];
function dimension(value, fallback, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}
function settings(value = {}) {
  return Object.assign({}, value, {
    mode: modes.includes(value.mode) ? value.mode : 'process',
    length: dimension(value.length, 3, 1.5, 8), width: dimension(value.width, 1.6, 0.6, 6)
  });
}
function layout(value = {}) {
  const config = settings(value), {length, width} = config;
  if(config.catalogueEquipmentId){
    const definition=require('../../equipamiento/schema/equipmentCatalog.cjs').definition(config.catalogueEquipmentId);
    if(!definition||definition.nativeKind!=='processor')throw new Error('Identidad de estación de proceso no compatible.');
    // Pallet-sized stations need a real, wider support outside the mechanism,
    // not a relaxed fit check against the former one-metre box buffer. The
    // geometry consumes these same dimensions and centres.
    const palletSized=width>=1.5,bufferLength=palletSized?1.5:1.1,bufferWidth=Math.max(.6,Math.min(width,palletSized?1.6:1.2));
    const portOffset=palletSized?bufferLength:.8,centreOffset=palletSized?bufferLength/2:.45;
    const input={x:-length/2-portOffset,y:0,z:0,tx:1,tz:0},output={x:length/2+portOffset,y:0,z:0,tx:1,tz:0},inputPosition=[-length/2-centreOffset,0,0],outputPosition=[length/2+centreOffset,0,0];
    return {mode:config.mode,length:length+2*portOffset,width,bodyLength:length,bodyWidth:width,bufferLength,bufferWidth,loadLength:bufferLength,loadWidth:bufferWidth,input,inlet:input,output,outlet:output,inputPosition,queuePosition:inputPosition.slice(),outputPosition,slots:[{x:inputPosition[0],y:0,z:0},{x:outputPosition[0],y:0,z:0}],floor:-1,deckHeight:0,catalogueEquipmentId:definition.id};
  }
  const input = {x: -length / 2, y: 0, z: 0, tx: 1, tz: 0};
  const output = {x: length / 2, y: 0, z: 0, tx: 1, tz: 0};
  const inputPosition = [-length / 2 + 0.35, 0, 0], outputPosition = [length / 2 - 0.35, 0, 0];
  return {mode: config.mode, length, width, input, inlet: input, output, outlet: output,
    inputPosition, queuePosition: inputPosition.slice(), outputPosition,
    slots: [{x: inputPosition[0], y: 0, z: 0}, {x: outputPosition[0], y: 0, z: 0}],
    floor: -1, deckHeight: 0};
}

module.exports = {modes, settings, layout};
