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
  const input = {x: -length / 2, y: 0, z: 0, tx: 1, tz: 0};
  const output = {x: length / 2, y: 0, z: 0, tx: 1, tz: 0};
  const inputPosition = [-length / 2 + 0.35, 0, 0], outputPosition = [length / 2 - 0.35, 0, 0];
  return {mode: config.mode, length, width, input, inlet: input, output, outlet: output,
    inputPosition, queuePosition: inputPosition.slice(), outputPosition,
    slots: [{x: inputPosition[0], y: 0, z: 0}, {x: outputPosition[0], y: 0, z: 0}],
    floor: -1, deckHeight: 0};
}

module.exports = {modes, settings, layout};
