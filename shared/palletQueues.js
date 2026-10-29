/* Standalone pallet stock geometry shared by authoring, rendering and flow. */
'use strict';
const pallets = require('./palletTypes.js');
const racks = require('./warehouseRacks.js');

function number(value, fallback, minimum, maximum, integer = false) {
  const result = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, integer ? Math.floor(result) : result));
}
function settings(value = {}) {
  if (racks.isRack(value)) return racks.normalize(value);
  const base = pallets.dimensions(value), width = number(base.width, 1.2, 0.4, 4), depth = number(base.depth, 1.05, 0.4, 4);
  const fit = value.layoutMode === 'fit';
  const columns = number(value.columns, 4, 1, 8, true), rows = number(value.rows, 3, 1, 8, true), layers = number(value.layers, 4, 1, fit ? 5 : 8, true);
  const palletCapacity = number(value.palletCapacity, 1, 1, 4, true), acceptsPallets = value.acceptsPallets === true;
  const maximum = acceptsPallets ? palletCapacity : fit ? 500 : columns * rows * layers * palletCapacity;
  const capacity = number(value.capacity, Math.min(48, maximum), 1, Math.min(fit ? 500 : 128, maximum), true);
  return Object.assign({}, value, {width, depth, columns, rows, layers, palletCapacity, acceptsPallets, capacity, palletHeight: base.height});
}
function bayCapacity(config, index) {
  if (racks.isRack(config)) return index >= 0 && index < racks.normalize(config).capacity ? 1 : 0;
  if (config.acceptsPallets) return index < config.capacity ? 1 : 0;
  if (config.layoutMode !== 'fit') return Math.max(0, Math.min(config.columns * config.rows * config.layers, config.capacity - index * config.columns * config.rows * config.layers));
  return Math.floor(config.capacity / config.palletCapacity) + (index < config.capacity % config.palletCapacity ? 1 : 0);
}
function layout(value = {}) {
  if (racks.isRack(value)) return racks.layout(value);
  const config = settings(value), bayColumns = config.palletCapacity === 1 ? 1 : 2, bayRows = Math.ceil(config.palletCapacity / bayColumns);
  // A tall stored load must leave room for the next load's leading half to
  // reach the transfer port. Legacy short-carton grids keep their old ports.
  const admission = config.layoutMode === 'fit' || config.palletType && config.palletType !== 'custom' ? config.width + .1 : .4;
  const length = Math.max(1.8, bayColumns * config.width + (bayColumns - 1) * .35 + admission), width = Math.max(1.45, bayRows * config.depth + (bayRows - 1) * .35 + .4);
  const input = {x: -length / 2, y: 0, z: 0, tx: 1, tz: 0}, output = {x: length / 2, y: 0, z: 0, tx: 1, tz: 0};
  const cellWidth = config.width / config.columns, cellDepth = config.depth / config.rows;
  const pallets = Array.from({length: config.palletCapacity}, (_, index) => ({index, position: [
    (index % bayColumns - (bayColumns - 1) / 2) * (config.width + .35), -1,
    (Math.floor(index / bayColumns) - (bayRows - 1) / 2) * (config.depth + .35)], top: -1 + config.palletHeight, width: config.width, depth: config.depth}));
  const slots = Array.from({length: config.capacity}, (_, index) => {
    const perPallet = config.acceptsPallets ? 1 : config.columns * config.rows * config.layers;
    let palletIndex = Math.floor(index / perPallet), localSlot = index % perPallet;
    if (config.layoutMode === 'fit' && !config.acceptsPallets) {
      palletIndex = 0; localSlot = index;
      while (palletIndex < config.palletCapacity - 1 && localSlot >= bayCapacity(config, palletIndex)) { localSlot -= bayCapacity(config, palletIndex); palletIndex++; }
    }
    const column = localSlot % config.columns, row = Math.floor(localSlot / config.columns) % config.rows, layer = Math.floor(localSlot / (config.columns * config.rows));
    // Actual layer height depends on the real loads underneath this cell.
    // Runtime adds their measured heights to this common pallet surface.
    return {palletIndex, localSlot, column, row, layer, x: pallets[palletIndex].position[0] + (column + 0.5) * cellWidth - config.width / 2, y: -0.85,
      z: pallets[palletIndex].position[2] + (row + 0.5) * cellDepth - config.depth / 2, width: cellWidth, depth: cellDepth};
  });
  return {length, width, input, inlet: input, output, outlet: output, floor: -1, deckHeight: 0,
    palletPosition: [0, -1, 0], palletTop: -1 + config.palletHeight, queuePosition: [0, -1 + config.palletHeight, 0], cellWidth, cellDepth, slots, pallets,
    pallet: {width: config.width, depth: config.depth, columns: config.columns, rows: config.rows, layers: config.layers, capacity: config.capacity, top: -1 + config.palletHeight, floor: -1}};
}

module.exports = {settings, layout, bayCapacity, pallets, racks};
