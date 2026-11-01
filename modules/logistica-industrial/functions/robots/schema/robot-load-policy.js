'use strict';

/** Grip topology and declared payload, shared by schema and native runtime.
 * A top suction cup touching a carton does not restrain its pallet or the
 * other loose cartons. Bottom-support tools can carry a complete rated unit.
 * This is a simulation admission rule, not a vacuum/stability calculation. */
function assess(config = {}, metadata = {}) {
 const pallet = metadata.loadMode === 'pallet' || metadata.loadType === 'pallet' || metadata.productType === 'pallet' || metadata.type === 'pallet';
 const toolMassKg = Number.isFinite(config.toolMassKg) && config.toolMassKg >= 0 ? config.toolMassKg : 0;
 const mass = metadata.massKg !== undefined ? metadata.massKg : metadata.weightKg !== undefined ? metadata.weightKg : metadata.mass;
 const massKnown = typeof mass === 'number' && Number.isFinite(mass) && mass > 0;
 const loadMassKg = massKnown ? mass : null, totalMassKg = massKnown ? mass + toolMassKg : toolMassKg;
 const support = ['fork','platform'].includes(config.tool) ? 'underside' : config.tool === 'vacuum' ? 'top-suction' : config.tool === 'gripper' ? 'lateral-grip' : 'process';
 const result = {accepted: true, reason: '', massKnown, loadMassKg, toolMassKg, totalMassKg, support};
 if (pallet && support !== 'underside') return Object.assign(result, {accepted: false, reason: 'Un pallet completo necesita apoyo inferior: selecciona horquillas o plataforma con capacidad suficiente. Las ventosas o la pinza de cajas no sujetan el pallet ni las cajas sueltas.'});
 if (Number.isFinite(config.payloadKg) && totalMassKg > config.payloadKg + 1e-8) return Object.assign(result, {accepted: false, reason: 'La masa de carga' + (pallet ? ' y tara del pallet' : '') + ' más herramienta (' + totalMassKg.toFixed(2) + ' kg) supera la capacidad configurada (' + config.payloadKg + ' kg).'});
 return result;
}
module.exports = {assess};
