/* Standalone pallet stock geometry shared by authoring, rendering and flow. */
'use strict';

function number(value, fallback, minimum, maximum, integer = false) {
  const result = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, integer ? Math.floor(result) : result));
}
function settings(value = {}) {
  const width = number(value.width, 1.2, 0.4, 4), depth = number(value.depth, 1.05, 0.4, 4);
  const columns = number(value.columns, 4, 1, 8, true), rows = number(value.rows, 3, 1, 8, true), layers = number(value.layers, 4, 1, 8, true);
  const capacity = number(value.capacity, Math.min(48, columns * rows * layers), 1, Math.min(128, columns * rows * layers), true);
  return Object.assign({}, value, {width, depth, columns, rows, layers, capacity});
}
function layout(value = {}) {
  const config = settings(value), length = Math.max(1.8, config.width + 0.4), width = Math.max(1.45, config.depth + 0.4);
  const input = {x: -length / 2, y: 0, z: 0, tx: 1, tz: 0}, output = {x: length / 2, y: 0, z: 0, tx: 1, tz: 0};
  const cellWidth = config.width / config.columns, cellDepth = config.depth / config.rows;
  const slots = Array.from({length: config.capacity}, (_, index) => {
    const column = index % config.columns, row = Math.floor(index / config.columns) % config.rows, layer = Math.floor(index / (config.columns * config.rows));
    // Actual layer height depends on the real loads underneath this cell.
    // Runtime adds their measured heights to this common pallet surface.
    return {column, row, layer, x: (column + 0.5) * cellWidth - config.width / 2, y: -0.85,
      z: (row + 0.5) * cellDepth - config.depth / 2, width: cellWidth, depth: cellDepth};
  });
  return {length, width, input, inlet: input, output, outlet: output, floor: -1, deckHeight: 0,
    palletPosition: [0, -1, 0], palletTop: -0.85, queuePosition: [0, -0.85, 0], cellWidth, cellDepth, slots,
    pallet: {width: config.width, depth: config.depth, columns: config.columns, rows: config.rows, layers: config.layers, capacity: config.capacity, top: -0.85, floor: -1}};
}

module.exports = {settings, layout};
