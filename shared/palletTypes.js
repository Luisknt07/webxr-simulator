/* Metric pallet templates, not certification or load-rating claims.
 * EPAL: epal-pallets.org/eu-en/load-carriers/overview (Euro/3/6).
 * Plastic dimensions follow Craemer's 2025 plastic pallet catalogue.
 */
'use strict';
const types = [
  {id: 'custom', label: 'Personalizado', width: 1.2, depth: 1.05},
  {id: 'euro-1200x800', label: 'Europeo 1200 x 800 mm', width: 1.2, depth: .8},
  {id: 'industrial-1200x1000', label: 'Industrial 1200 x 1000 mm', width: 1.2, depth: 1},
  {id: 'half-800x600', label: 'Medio pallet 800 x 600 mm', width: .8, depth: .6}
];
function dimensions(config = {}, source = false) {
  const type = types.find(value => value.id === config.palletType) || types[0], plastic = config.palletMaterial === 'plastic';
  const width = type.id === 'custom' ? (source ? config.palletWidth : config.width) || 1.2 : type.width;
  const depth = type.id === 'custom' ? (source ? config.palletDepth : config.depth) || (source ? 1 : 1.05) : type.depth;
  return {type: type.id, material: plastic ? 'plastic' : 'wood', width, depth,
    height: type.id === 'custom' ? .15 : plastic ? .16 : .144,
    // Editable simulated tare, not a certified capacity. Legacy custom wood20kg.
    tare: plastic ? 12 : type.id === 'half-800x600' ? 10 : type.id === 'euro-1200x800' ? 25 : 20};
}
const EPS = 1e-7, GAP = .005;
function overlaps(a, b) { return a.x < b.x + b.width - EPS && a.x + a.width > b.x + EPS && a.z < b.z + b.depth - EPS && a.z + a.depth > b.z + EPS && a.y < b.y + b.height - EPS && a.y + a.height > b.y + EPS; }
/** Deterministic supported orthogonal packing. Units remain their real size.
 * Positions use a pallet's lower-left corner and measured package envelopes.
 * A layer may only rest on a complete support footprint, never on empty air.
 */
function place(width, depth, size, existing = [], maxLayers = 5, allowRotation = true, maxHeight = 0) {
  const ys = [0], xs = [0], zs = [0];
  existing.forEach(item => { ys.push(item.y + item.height + GAP); xs.push(item.x + item.width + GAP); zs.push(item.z + item.depth + GAP); });
  const unique = values => Array.from(new Set(values.map(value => Math.round(value * 1e8) / 1e8))).sort((a, b) => a - b);
  for (const y of unique(ys)) for (const z of unique(zs)) for (const x of unique(xs)) for (const rotated of allowRotation ? [false, true] : [false]) {
    const candidate = {x, y, z, width: rotated ? size.depth : size.width, depth: rotated ? size.width : size.depth, height: size.height, rotated, layer: 1};
    if (x + candidate.width > width + EPS || z + candidate.depth > depth + EPS || maxHeight > 0 && y + candidate.height > maxHeight + EPS || existing.some(item => overlaps(candidate, item))) continue;
    if (y > EPS) {
      let support = 0, layer = 0;
      existing.forEach(item => {
        if (Math.abs(item.y + item.height + GAP - y) > EPS) return;
        const area = Math.max(0, Math.min(x + candidate.width, item.x + item.width) - Math.max(x, item.x)) * Math.max(0, Math.min(z + candidate.depth, item.z + item.depth) - Math.max(z, item.z));
        support += area; if (area > EPS) layer = Math.max(layer, item.layer || 1);
      });
      if (support < candidate.width * candidate.depth * .98) continue;
      candidate.layer = layer + 1;
    }
    if (candidate.layer <= maxLayers) return candidate;
  }
  return null;
}
function pack(width, depth, size, layers = 5, limit = 64) {
  const result = [];
  while (result.length < limit) { const next = place(width, depth, size, result, layers); if (!next) break; result.push(next); }
  return result;
}
module.exports = {types, dimensions, place, pack, overlaps, GAP};
