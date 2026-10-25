import schema from '../../shared/behaviors.js';

const GENERATED_BOARD = /^(?:(?:\d{2} · )?Rótulo ·|Guía ·|Guía de red ·|Etiqueta de destino ·|CEDI · guía del proceso)/;
const COLORS = ['#172d42', '#182b38'];

/** Adapt only known generated info boards. Source/PLC/LineMonitor, authored
 * content and custom boards keep their identities, recipes and transforms. */
export function applyIndustrialMessages(document, roomId, options = {}) {
  if (options.enabled === false) return {changedObjectIds: [], boards: [], changed: false};
  const objects = document.getObjects(roomId).filter(object => {
    const descriptor = object.userData.editorDescriptor;
    return descriptor && descriptor.type === 'box' && COLORS.includes(descriptor.color) && GENERATED_BOARD.test(object.name) && !object.userData.editorColor &&
      document.getBehaviors(object).some(value => value.type === 'info') && !document.getBehaviors(object).some(value => schema.simulationTypes.includes(value.type) || ['lineMonitor', 'control', 'sensor', 'plc'].includes(value.type));
  });
  const own = !document.transaction, boards = [], changedObjectIds = []; if (own) document.begin();
  try {
    objects.forEach(object => {
      const before = document.getBehaviors(object), current = before.find(value => value.type === 'info'), width = options.width === undefined ? 1 : options.width;
      const info = Object.assign({}, current, {presentation: 'contextual', revealDistance: 5, fadeDistance: .75, fadeTime: .22, gazeAngle: 110, width});
      const elevated = /^Etiqueta de destino ·/.test(object.name) && object.position.y > 2.7;
      const position = [object.position.x, elevated ? object.position.y : 1.55, object.position.z], scale = [width, width * .625, .025];
      const behaviors = before.filter(value => value.type !== 'info').concat(info);
      const sameTransform = position.every((value, index) => Math.abs(value - object.position.getComponent(index)) < 1e-9) && scale.every((value, index) => Math.abs(value - object.scale.getComponent(index)) < 1e-9);
      const changed = JSON.stringify(current) !== JSON.stringify(info) || !sameTransform;
      if (changed) { document.setBehaviors(object, behaviors); document.setTransform(object, {position, scale}); changedObjectIds.push(object.userData.editorId); }
      boards.push({objectId: object.userData.editorId, name: object.name, presentation: 'contextual', width, height: width * .625, elevated, changed});
    });
    if (own) document.commit(); return {changedObjectIds, boards, changed: changedObjectIds.length > 0};
  } catch (error) { if (own) document.cancel(); throw error; }
}
