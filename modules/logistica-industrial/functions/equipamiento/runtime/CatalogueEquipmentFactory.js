import catalog from '../schema/equipmentCatalog.cjs';

/** Native adapter: the real native factory owns actors, rigs and control IDs.
 * A semantic catalogue is not a second modelling or simulation engine. */
function annotate(root, definition, config, deps) {
  if (!root || !root.userData || !root.traverse) throw new Error('Native equipment factory returned no scene actor.');
  root.name = definition.title;
  root.userData.catalogueEquipmentId = definition.id;
  root.userData.catalogueEquipmentVersion = catalog.VERSION;
  root.userData.catalogueOperationLevel = definition.operationLevel;
  root.userData.catalogueSourceRefs = definition.sourceRefs.map(row => ({key: row.key, id: row.id, namespace: row.namespace}));
  const behavior = (root.userData.editorDefaultBehaviors || []).find(row => row.type === definition.behaviorType);
  if (behavior) {
    behavior.catalogueEquipmentId = definition.id;
    if (definition.nativeKind === 'processor') behavior.operationParametersJson = config.operationParametersJson || '{}';
  }
  if (typeof deps.applyEquipmentGeometry === 'function') deps.applyEquipmentGeometry(root, definition, config, Object.assign({}, deps, {layout: catalog.layout(definition.id, config)}));
  root.updateMatrixWorld(true);
  return root;
}

export function createCatalogueEquipment(id, value = {}, deps = {}) {
  const definition = catalog.definition(id), config = catalog.normalize(id, value);
  if (['attachment', 'workspace'].includes(definition.operationLevel)) throw new Error('This catalogue entry is an attachment or workspace action, not a standalone replacement actor.');
  if (!definition.nativeKind || typeof deps.nativeFactory !== 'function') throw new Error('Equipment requires a native operational factory.');
  const native = deps.nativeFactory(definition.nativeKind, definition.nativeVariant, config);
  return annotate(native, definition, config, deps);
}

export function refreshCatalogueEquipment(root, value = {}, deps = {}) {
  const id = value.catalogueEquipmentId || root && root.userData && root.userData.catalogueEquipmentId;
  const definition = catalog.definition(id); if (!definition) return false;
  const config = catalog.normalize(id, value);
  // Caller supplies the unintercepted native refresh, avoiding recursion through
  // createIndustrialPrefab.refresh's catalogue dispatch branch.
  if (typeof deps.refreshNative === 'function') deps.refreshNative(root, config);
  annotate(root, definition, config, deps); return true;
}

export function toolConfiguration(id, robotConfig = {}) {
  const definition = catalog.definition(id);
  if (!definition || definition.role !== 'tool' || definition.operationLevel !== 'attachment') throw new Error('Select an attachable end-effector catalogue entry.');
  return Object.assign({}, robotConfig, {catalogueToolId: id, tool: definition.toolType,
    operation: definition.toolType === 'process' ? 'process' : 'pick-place'});
}

export function performCatalogueAction(resource, context = {}) {
  if (!resource || !resource.catalogueEquipmentId) throw new Error('Unknown equipment action.');
  const definition = catalog.definition(resource.catalogueEquipmentId);
  if (!definition) throw new Error('Unknown equipment action.');
  if (definition.operationLevel === 'workspace') {
    if (typeof context.openWorkspace !== 'function') throw new Error('This workspace capability is unavailable in the current module.');
    return context.openWorkspace(definition.workspace, definition.id);
  }
  if (definition.operationLevel === 'attachment') {
    if (typeof context.applyRobotTool !== 'function' || !context.canEdit || context.canEdit() !== true) throw new Error('An editable native robot is required for this tool.');
    return context.applyRobotTool(definition.id, config => toolConfiguration(definition.id, config));
  }
  if (typeof context.insertEquipment !== 'function' || !context.canEdit || context.canEdit() !== true) throw new Error('Equipment insertion is unavailable.');
  return context.insertEquipment(definition.id, Object.assign({}, definition.defaults));
}

export default createCatalogueEquipment;
