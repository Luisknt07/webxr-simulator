// The live teaching recipes share the same bounded machinery as their finite
// audit fixtures. Only explicitly authored examples opt into continuous supply
// and terminal dispatch; opening an existing project never changes its data.
const FORMATS = {
  'surface-case': {width: .45, depth: .3, height: .28, mass: 3},
  'damaged-case': {width: .4, depth: .35, height: .28, mass: 3.5},
  'priority-sku': {width: .5, depth: .4, height: .35, mass: 6},
  'blue-case': {width: .55, depth: .35, height: .3, mass: 5},
  'crate-case': {width: .45, depth: .4, height: .32, mass: 7},
  'wide-case': {width: .6, depth: .45, height: .3, mass: 8},
  'tall-case': {width: .4, depth: .35, height: .6, mass: 5},
  'long-case': {width: .4, depth: .7, height: .3, mass: 7},
  'pallet-carton': {width: .5, depth: .3, height: .23, mass: 2},
  'packing-green': {width: .45, depth: .35, height: .3, mass: 4},
  'packing-orange': {width: .4, depth: .35, height: .32, mass: 3},
  'packing-blue': {width: .5, depth: .4, height: .3, mass: 4.5},
  'mixed-box': {name: 'Caja grande de expedición', width: .55, depth: .4, height: .34, mass: 6},
  'mixed-crate': {width: .45, depth: .4, height: .3, mass: 7},
  'mixed-drum': {width: .35, depth: .35, height: .46, mass: 12},
  'mixed-bottle': {width: .24, depth: .24, height: .36, mass: 2}
};

export function liveProduct(product, enabled) {
  return enabled ? Object.assign({}, product, FORMATS[product.id] || {}) : product;
}

export function liveMachine(config, enabled, index = 0, manual = false) {
  if (!enabled || manual) return config;
  if (config.type === 'conveyor') {
    const values = {maxLoad: Math.max(config.maxLoad || 30, config.surface === 'chains' ? 600 : 150)};
    if (config.surface === 'chains') values.clearance = 2;
    // A longer transition gives the larger cartons enough flat approach and a
    // gentler change of pitch before the gravity section. The finite small-box
    // fixtures retain their shorter original conveyor.
    if (config.mechanism === 'transport' && config.gradeProfile === 'smooth' && config.rise && config.length < 2.6) values.length = 2.6;
    return Object.assign({}, config, values);
  }
  if (config.type === 'source' && config.autoGenerate) return Object.assign({}, config, {totalLimit: 0});
  if (config.type === 'palletQueue') return Object.assign({}, config, {
    palletType: index % 2 ? 'industrial-1200x1000' : 'euro-1200x800',
    palletMaterial: index % 3 === 1 ? 'plastic' : 'wood', layoutMode: 'fit',
    layers: 5, maxStackHeight: 1.8, palletCapacity: 4, capacity: config.acceptsPallets ? 4 : 128,
    autoRelease: true, releasePolicy: 'stockFull', releaseInterval: 3, autoReleasePressure: true
  });
  return config;
}

export function livePalletSource(config, enabled, plastic = false) {
  return !enabled ? config : Object.assign({}, config, {
    totalLimit: 0, palletType: plastic ? 'industrial-1200x1000' : 'euro-1200x800',
    palletMaterial: plastic ? 'plastic' : 'wood', palletPacking: 'fit',
    palletLayers: 5, interval: 18, outputInterval: 4
  });
}
