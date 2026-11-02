'use strict';

// A document code is a provenance reference, never a machine identity. The two
// source books reuse 156 codes, with substantially different meanings.
const NEW_SOURCE = 'nexus-illustrated-2026';
const LEGACY_SOURCE = 'nexus-conceptual-198';
const NEW = {
 UC: 'product.wood-pallet product.plastic-pallet product.metal-pallet product.standard-pallet product.slip-sheet product.carton product.tote product.roll-container product.sack product.drum product.ibc product.bottle-can-tray product.discrete-part product.long-stock product.bulk-fluid product.conditioned',
 MU: 'vehicle.freight-truck dock.loading-dock dock.leveler dock.restraint dock.tail-lift dock.forklift-station dock.pallet-truck-station dock.atls dock.lift-table sensor.weigh-dimension',
 VE: 'vehicle.manual-cart vehicle.pallet-truck-manual vehicle.pallet-truck-electric vehicle.stacker vehicle.counterbalance vehicle.reach-truck vehicle.vna vehicle.order-picker vehicle.sideload-multidirectional vehicle.tow-tractor vehicle.ergonomic-manipulator vehicle.overhead-crane tool.forklift-attachment',
 MO: 'mobile.agv-platform mobile.agv-forks mobile.agv-tug mobile.amr-platform mobile.amr-pallet-lift mobile.amr-underride mobile.amr-top-conveyor robot.mobile-manipulator mobile.rgv control.charging-station monitor.fleet',
 TR: 'transport.roller-gravity transport.roller-box transport.roller-pallet transport.flat-belt transport.modular-belt transport.slat-chain transport.pallet-chain transport.zero-pressure transport.curve transport.popup-transfer transport.turntable transport.pusher transport.merge transport.telescopic transport.vertical-lift transport.spiral transport.overhead transport.transfer-cart transport.crossbelt-sorter transport.shoe-sorter transport.tilt-tray-sorter transport.vibratory transport.screw transport.bucket-elevator transport.pneumatic transport.stops-guides',
 AL: 'storage.selective storage.double-deep storage.drive-in storage.drive-through storage.push-back storage.pallet-flow storage.carton-flow storage.cantilever storage.mobile storage.block storage.light-medium storage.mezzanine storage.pallet-shuttle storage.automatic-pallet-shuttle storage.pallet-asrs storage.miniload storage.multilevel-shuttle storage.cube storage.vertical-lift storage.carousel',
 PI: 'vehicle.picking-cart sensor.barcode-rf picking.pick-to-light picking.voice picking.goods-to-person picking.goods-to-robot picking.put-wall packaging.carton-erector packaging.case-packer packaging.seal-strap packaging.stretch-wrapper packaging.print-apply sensor.checkweigher packaging.pallet-dispenser packaging.layer-palletizer packaging.robot-palletizer packaging.depalletizer',
 RO: 'robot.articulated robot.four-axis-palletizer robot.scara robot.delta robot.cartesian robot.gantry robot.collaborative robot.heavy robot.painting robot.inspection robot.external-positioner',
 EO: 'tool.vacuum-single tool.vacuum-area tool.layer-gripper tool.parallel-gripper tool.three-finger tool.angular-gripper tool.adaptive-soft tool.magnet tool.needle tool.sack-gripper tool.side-clamp tool.forks tool.drum-gripper tool.double-gripper tool.screwdriver tool.arc-welder tool.spot-welder tool.paint-spray tool.adhesive tool.spindle tool.camera-probe tool.force-torque tool.changer-stand',
 MA: 'machine.saw machine.energy-cutting machine.cnc-lathe machine.machining-center machine.drill-tap machine.press-brake machine.stamping-press machine.injection-molder machine.extruder machine.additive-printer machine.welding-cell machine.paint-curing machine.oven machine.cooling machine.assembly-bench machine.vibratory-feeder machine.stock-feeder machine.fixture machine.finishing machine.tank-mixer machine.pump-valve machine.filler machine.washer machine.test-bench machine.cmm',
 SE: 'sensor.photoelectric sensor.inductive-capacitive sensor.encoder-limit sensor.barcode-rfid sensor.vision-distance sensor.process control.plc-robot control.hmi monitor.scada monitor.warehouse monitor.business safety.guard safety.presence-stop utility.extraction utility.energy storage.reject-bin monitor.assistant'
};
const LEGACY = {
 TR: 'transport.roller-gravity transport.roller-box transport.flat-belt transport.modular-belt transport.pallet-chain transport.zero-pressure transport.curve transport.junction transport.popup-transfer transport.turntable transport.pusher transport.telescopic transport.vertical-lift transport.overhead transport.spiral transport.shoe-sorter transport.crossbelt-sorter transport.tilt-tray-sorter transport.transfer-cart transport.vibratory transport.screw transport.bucket-elevator transport.pneumatic',
 VE: 'vehicle.manual-cart vehicle.pallet-truck-manual vehicle.pallet-truck-electric vehicle.stacker vehicle.counterbalance vehicle.reach-truck vehicle.vna vehicle.order-picker vehicle.tow-tractor mobile.agv-platform mobile.agv-forks mobile.amr-platform mobile.amr-pallet-lift mobile.autonomous-forklift mobile.agv-tug vehicle.overhead-crane mobile.rgv vehicle.freight-truck dock.tail-lift mobile.inventory-drone',
 AL: 'storage.selective storage.double-deep storage.drive-in storage.drive-through storage.push-back storage.pallet-flow storage.cantilever storage.mobile storage.pallet-shuttle storage.pallet-asrs storage.miniload storage.multilevel-shuttle storage.cube storage.vertical-lift storage.carousel storage.carton-flow storage.light-medium storage.block',
 UC: 'product.carton product.loaded-pallet product.wood-pallet product.plastic-pallet product.metal-pallet product.tote product.sack product.drum product.ibc product.bottle-can-tray product.bulk-fluid product.metal-part product.fragile-electronic product.textile product.conditioned product.long-stock product.oversize product.hazardous',
 MU: 'dock.loading-dock dock.leveler dock.restraint picking.receiving-inspection sensor.platform-scale sensor.dimensioner sensor.barcode-rf sensor.rfid-portal dock.forklift-station transport.stops-guides dock.lift-table dock.atls',
 PI: 'vehicle.picking-cart picking.pick-to-light picking.voice picking.put-wall picking.goods-to-person picking.goods-to-robot picking.decanting picking.consolidation',
 EM: 'picking.packing-bench packaging.carton-erector packaging.carton-sealer packaging.case-packer packaging.print-apply sensor.checkweigher packaging.stretch-wrapper packaging.strapper packaging.pallet-dispenser packaging.layer-palletizer packaging.robot-palletizer packaging.depalletizer',
 RO: 'robot.articulated robot.four-axis-palletizer robot.scara robot.delta robot.cartesian robot.gantry robot.collaborative mobile.amr-platform robot.mobile-manipulator robot.welding robot.painting robot.inspection robot.finishing robot.heavy',
 EO: 'tool.vacuum-single tool.vacuum-area tool.parallel-gripper tool.three-finger tool.angular-gripper tool.adaptive-gripper tool.soft-gripper tool.magnet tool.needle tool.sack-gripper tool.side-clamp tool.forks tool.drum-gripper tool.double-gripper tool.screwdriver tool.mig-welder tool.tig-welder tool.spot-welder tool.paint-spray tool.adhesive tool.spindle tool.cutter tool.camera tool.probe tool.force-torque tool.changer tool.stand',
 MA: 'machine.saw machine.energy-cutting machine.cnc-lathe machine.machining-center machine.drill-tap machine.press-brake machine.stamping-press machine.injection-molder machine.extruder machine.additive-printer machine.welding-source machine.positioner machine.paint-booth machine.oven machine.finishing machine.assembly-bench machine.vibratory-feeder machine.insertion-press machine.cmm machine.test-bench machine.hopper-doser utility.extraction',
 SE: 'sensor.photoelectric sensor.inductive-capacitive sensor.encoder-limit sensor.load-pressure sensor.condition utility.motor-drive utility.servo utility.fluid-actuator safety.guard safety.presence-stop safety.emergency-rearm utility.energy',
 SI: 'monitor.erp monitor.wms control.wcs monitor.wes monitor.mes monitor.scada control.hmi control.plc control.robot monitor.fleet monitor.digital-twin monitor.assistant'
};
function map(source, groups) {
 const out = {};
 Object.entries(groups).forEach(([family, list]) => list.split(' ').forEach((semantic, i) => {
  out[source + ':' + family + '-' + String(i + 1).padStart(2, '0')] = 'equipment.' + semantic;
 }));
 return out;
}
const LINKS = Object.freeze(Object.assign(map(LEGACY_SOURCE, LEGACY), map(NEW_SOURCE, NEW)));
function canonicalId(sourceKey) { return LINKS[sourceKey] || null; }
function sourceRows(namespace, records) {
 return records.map(row => {
  const key = namespace + ':' + row.id, canonical = canonicalId(key);
  if (!canonical) throw new Error('No reviewed semantic binding for ' + key);
  return {key, sourceId: row.id, namespace, title: row.title, familyId: row.familyId || row.family, canonicalId: canonical};
 });
}
module.exports = {NEW_SOURCE, LEGACY_SOURCE, LINKS, canonicalId, sourceRows};
