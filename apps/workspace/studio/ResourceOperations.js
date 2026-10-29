/* Resource operations change lightweight project references, never uploaded
 * content-addressed files. They share SceneDocument's undo/import snapshot.
 */

function assetKey(resource) { return resource && resource.asset && (resource.asset.importId || resource.asset.id) || ''; }
function assertReady(editor) {
  if (!editor || !editor.document || !editor.library) throw new Error('El proyecto todavía no está listo.');
  if (editor.loadingProject || editor.busy || editor.pastingObject || editor.document.transaction) throw new Error('Termina la operación actual antes de organizar o eliminar recursos.');
}
function references(value, keys, visited = new Set(), depth = 0) {
  if (depth > 40 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    if (keys.has(value)) return true;
    // Wear layers, automation and material assignments are persisted JSON.
    // Parse bounded JSON text instead of missing references inside these fields.
    if (value.length <= 2 * 1024 * 1024 && /^[\s]*[\[{]/.test(value)) {
      try { return references(JSON.parse(value), keys, visited, depth + 1); } catch (error) { return false; }
    }
    return false;
  }
  if (typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  return Object.keys(value).some(key => references(value[key], keys, visited, depth + 1));
}
function projectIdentity(editor) { return [editor.document, editor.projectGeneration, editor.currentProject && editor.currentProject.id]; }
function stillCurrent(editor, identity) { const current = projectIdentity(editor); return current.every((value, index) => value === identity[index]); }

/** Every inactive room is checked too: unloading its GPU model does not remove
 * the authoring records that reference a texture or imported mesh.
 */
export async function usage(editor, resource) {
  assertReady(editor);
  if (!resource || resource.origin !== 'project') return [{id: 'included-resource', label: 'Recurso incluido: la Biblioteca se conserva para todos los proyectos.'}];
  const key = assetKey(resource), templateId = resource.action && resource.action.type === 'template' && resource.action.template.id;
  if (!key && !templateId) return [{id: 'unsupported-resource', label: 'Este tipo de recurso no admite eliminación desde el navegador.'}];
  const identity = projectIdentity(editor), data = await editor.document.serialize();
  if (!stillCurrent(editor, identity)) throw new Error('El proyecto cambió durante la comprobación de referencias. Vuelve a intentarlo.');
  const keys = new Set([resource.id]);
  if (key) { keys.add(key); if (resource.asset.path) keys.add(resource.asset.path); }
  if (templateId) keys.add(templateId);
  const results = [], seen = new Set();
  const add = (id, label) => { if (!seen.has(id)) { seen.add(id); results.push({id, label}); } };
  const sceneName = id => { const found = data.studio && (data.studio.scenes || []).find(scene => scene.id === id); return found ? found.name : id; };
  Object.keys(data.rooms || {}).forEach(roomId => {
    const room = data.rooms[roomId];
    (room.additions || []).concat(room.overrides || []).forEach(record => {
      if (references(record, keys)) add('scene:' + roomId + ':' + record.id, sceneName(roomId) + ' · ' + (record.name || record.id));
    });
  });
  const studio = data.studio || {};
  (studio.templates || []).filter(template => template.id !== templateId).forEach(template => { if (references(template.objects, keys)) add('template:' + template.id, 'Plantilla · ' + template.name); });
  ['widgets', 'missions'].forEach(type => (studio[type] || []).forEach(item => { if (references(item, keys)) add(type + ':' + item.id, (type === 'widgets' ? 'Interfaz · ' : 'Misión · ') + item.name); }));
  (studio.environments || []).forEach(item => { if (references(item, keys)) add('environment:' + item.roomId, 'Ambiente de sonido · ' + sceneName(item.roomId)); });
  if (references(editor.objectClipboard, keys)) add('clipboard:object', 'Portapapeles · objeto copiado');
  if (references(editor.behaviorClipboard, keys)) add('clipboard:behaviors', 'Portapapeles · funciones copiadas');
  if (key) {
    const imports = editor.library.exportImports();
    const original = imports.find(entry => entry.id === key);
    if (!original) throw new Error('El archivo importado ya no existe en el proyecto.');
    // glTF/OBJ/FBX resolve sibling files through their import batch. Without
    // parsing external authoring formats, keep possible dependencies rather
    // than claiming a texture/bin is unused and breaking a future model load.
    if (original.batchId) imports.filter(entry => entry.id !== key && entry.batchId === original.batchId && ['gltf', 'obj', 'fbx'].includes(String(entry.extension || entry.path.split('.').pop()).toLowerCase())).forEach(entry => {
      add('dependency:' + entry.id, 'Posible dependencia del lote importado · ' + (entry.name || entry.path) + '. Retira primero ese modelo o conserva sus archivos asociados.');
    });
  }
  return results;
}

/** Re-check at confirmation time, so a stale usage dialog cannot delete a
 * resource that was placed or assigned to a material in the meantime.
 */
export async function remove(editor, resource) {
  assertReady(editor);
  if (!resource || resource.origin !== 'project') throw new Error('Los recursos de la Biblioteca no se eliminan del proyecto.');
  const identity = projectIdentity(editor), uses = await usage(editor, resource);
  if (!stillCurrent(editor, identity)) throw new Error('El proyecto cambió antes de eliminar el recurso. Vuelve a intentarlo.');
  if (uses.length) throw new Error('El recurso está en uso: ' + uses[0].label);
  const document = editor.document, key = assetKey(resource), templateId = resource.action && resource.action.type === 'template' && resource.action.template.id;
  document.begin();
  try {
    const studio = document.studio || {version: 1};
    const organization = Object.assign({folders: [], resources: [], favorites: []}, studio.organization || {});
    organization.resources = organization.resources.filter(entry => entry.id !== resource.id);
    organization.favorites = organization.favorites.filter(id => id !== resource.id);
    const patch = {organization};
    if (key) editor.library.restoreImports(editor.library.exportImports().filter(entry => entry.id !== key));
    else if (templateId) patch.templates = (studio.templates || []).filter(template => template.id !== templateId);
    else throw new Error('Este recurso no admite eliminación.');
    document.setStudio(patch); document.commit();
  } catch (error) { document.cancel(); throw error; }
  const entries = await editor.library.getCatalog();
  if (!stillCurrent(editor, identity)) return true;
  editor.entries = entries;
  if (editor.selectedAsset && key && (editor.selectedAsset.importId || editor.selectedAsset.id) === key) editor.selectedAsset = null;
  if (editor.resourceBrowser) editor.resourceBrowser.clearPreview();
  if (editor.renderAssets) editor.renderAssets();
  if (editor.toast) editor.toast('Referencia eliminada. Puedes deshacer; los archivos compartidos del servidor se conservan.');
  return true;
}
